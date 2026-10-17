-- Cached family balance + debt by due date (docs/AUDIT-2026-10-17.md §6.3): debt aging and the debtors
-- list read this instead of allocating every debtor family's whole ledger on each page view.

CREATE TABLE "FamilyBalance" (
    "familyId" TEXT NOT NULL,
    "centerId" TEXT NOT NULL,
    "balance" BIGINT NOT NULL,
    "totalDebt" BIGINT NOT NULL,
    "oldestUnpaidDate" DATE,
    "dues" JSONB NOT NULL DEFAULT '[]',
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FamilyBalance_pkey" PRIMARY KEY ("familyId")
);
CREATE INDEX "FamilyBalance_centerId_balance_idx" ON "FamilyBalance"("centerId", "balance");
ALTER TABLE "FamilyBalance" ADD CONSTRAINT "FamilyBalance_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "FamilyBalanceDirty" (
    "id" BIGSERIAL NOT NULL,
    "centerId" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FamilyBalanceDirty_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "FamilyBalanceDirty_centerId_familyId_idx" ON "FamilyBalanceDirty"("centerId", "familyId");

-- Every ledger change queues its family, whichever code path wrote it. Statement-level with transition
-- tables: one queue row per family per statement (a createMany of 500 charges queues each family once).
-- Insert-only, so writers never wait on each other or on the refresher.
CREATE FUNCTION family_balance_dirty_new() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO "FamilyBalanceDirty" ("centerId", "familyId") SELECT DISTINCT "centerId", "familyId" FROM new_rows;
  RETURN NULL;
END $$;
CREATE FUNCTION family_balance_dirty_old() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO "FamilyBalanceDirty" ("centerId", "familyId") SELECT DISTINCT "centerId", "familyId" FROM old_rows;
  RETURN NULL;
END $$;
CREATE FUNCTION family_balance_dirty_both() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO "FamilyBalanceDirty" ("centerId", "familyId")
  SELECT "centerId", "familyId" FROM new_rows UNION SELECT "centerId", "familyId" FROM old_rows;
  RETURN NULL;
END $$;
CREATE TRIGGER "LedgerEntry_balance_insert" AFTER INSERT ON "LedgerEntry"
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION family_balance_dirty_new();
CREATE TRIGGER "LedgerEntry_balance_update" AFTER UPDATE ON "LedgerEntry"
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION family_balance_dirty_both();
CREATE TRIGGER "LedgerEntry_balance_delete" AFTER DELETE ON "LedgerEntry"
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION family_balance_dirty_old();

-- Existing data: queue every family with a ledger; the worker (and the first read) fill the cache.
INSERT INTO "FamilyBalanceDirty" ("centerId", "familyId") SELECT DISTINCT "centerId", "familyId" FROM "LedgerEntry";
