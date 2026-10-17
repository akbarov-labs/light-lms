// Student CSV import (HANDOFF §17), framework-free so it can be tested on the database.
// Idempotent: importing the same file again creates no student, enrollment or opening balance twice.
import { db, type Tx } from "@/lib/db";
import { audit } from "@/lib/audit";
import { assertFamilyAccess, canAccessBranch, UserError, type Ctx } from "@/lib/ctx-core";
import { parseCsv } from "@/lib/csv-parse";
import { normalizePhone } from "@/lib/phone";
import { parseMoney } from "@/lib/money";
import { fromISODate, monthRange, shiftMonth, todayISO, type ISODate } from "@/lib/dates";
import { makeT } from "@/lib/i18n";
import { centerUsage } from "@/lib/services/plan-usage";
import { assertBillable } from "@/lib/services/enrollments";
import { debtSinceColumn, parseImportDate } from "./import-parse";

/** Marker of an opening balance on LedgerEntry.period (no billingKey: it is not an engine unit). */
export const OPENING_PERIOD = "opening";

/** Same late-joiner rule as a manual enrollment (audit B8), reported as a row error. */
async function billableOrRowError(tx: Tx, enrollmentId: string, t: ReturnType<typeof makeT>): Promise<void> {
  try {
    await assertBillable(tx, enrollmentId);
  } catch (e) {
    if (e instanceof UserError) throw new Error(t("money.wholeCourseFull"));
    throw e;
  }
}
// opening balances imported before the marker existed are recognised by their description
const LEGACY_OPENING = [makeT("uz")("import.opening"), makeT("ru")("import.opening")];

export async function familyHasOpening(tx: Tx, familyId: string): Promise<boolean> {
  const e = await tx.ledgerEntry.findFirst({ where: { familyId, OR: [{ period: OPENING_PERIOD }, { description: { in: LEGACY_OPENING } }] }, select: { id: true } });
  return !!e;
}

/**
 * The student this row describes, if already in the center: same first + last name (any case) and
 * the same phone (student's own, or a guardian's of their family). A row without any phone matches
 * a phoneless student of a family without guardians — what an earlier import of it created.
 */
async function findExisting(tx: Tx, centerId: string, firstName: string, lastName: string, phones: string[]) {
  const name = { firstName: { equals: firstName, mode: "insensitive" as const }, lastName: { equals: lastName, mode: "insensitive" as const } };
  const where = phones.length
    ? { centerId, ...name, OR: [{ phone: { in: phones } }, { family: { guardians: { some: { phone: { in: phones } } } } }] }
    : { centerId, ...name, phone: null, family: { guardians: { none: {} } } };
  return tx.student.findFirst({ where, orderBy: { createdAt: "asc" }, select: { id: true, familyId: true } });
}

export interface ImportResult {
  message: string;
  created: number;
  existing: number;
  errors: string[];
}

export async function importStudents(ctx: Ctx, text: string, dry: boolean): Promise<ImportResult> {
  const { t } = ctx;
  const rows = parseCsv(text);
  let header: string[] | null = null;
  if (rows.length && !/^[-−–]?[\d\s,.'  ]*$/.test(rows[0][5] ?? "0") && !/^\d+$/.test((rows[0][4] ?? "").replace("#", ""))) header = rows.shift() ?? null;
  const sinceCol = debtSinceColumn(header);
  const groups = await db.group.findMany({ where: { centerId: ctx.centerId }, select: { id: true, code: true, branchId: true } });
  const byCode = new Map(groups.map((g) => [String(g.code), g]));
  const today = todayISO();
  const nextMonth = monthRange(shiftMonth(today.slice(0, 7), 1)).start;
  const errors: string[] = [];
  const existingRows: string[] = [];
  let created = 0;
  // plan limit: each imported row with a group becomes a new active student
  let seats = (await centerUsage(ctx.centerId)).remaining;
  const seenInDryRun = new Set<string>();

  for (const [i, r] of rows.entries()) {
    const n = i + 1;
    const [lastName, firstName, phoneRaw, parentRaw, codeRaw, balanceRaw] = r;
    const sinceRaw = r[sinceCol] ?? "";
    if (!lastName || !firstName) {
      errors.push(t("import.row", { n, msg: t("import.noName") }));
      continue;
    }
    const code = (codeRaw ?? "").replace("#", "").trim();
    const group = code ? byCode.get(code) : null;
    if (code && (!group || !canAccessBranch(ctx, group.branchId))) {
      errors.push(t("import.row", { n, msg: t("import.noGroup", { code }) }));
      continue;
    }
    // parseMoney: "-300 000,00" → −300 000 (zero decimals only), Unicode minus included
    const balance = balanceRaw ? parseMoney(balanceRaw) : 0;
    if (balance === null) {
      errors.push(t("import.row", { n, msg: t("import.badBalance") }));
      continue;
    }
    if (balance !== 0 && !ctx.can("payments.refund")) {
      errors.push(t("import.row", { n, msg: t("import.balanceNeedsRefund") }));
      continue;
    }
    // the old debt ages from the date the center gives, not from the import day
    let debtSince: ISODate = today;
    if (sinceRaw.trim()) {
      const d = parseImportDate(sinceRaw);
      if (!d) {
        errors.push(t("import.row", { n, msg: t("money.import.badDebtSince") }));
        continue;
      }
      if (d > today) {
        errors.push(t("import.row", { n, msg: t("money.import.futureDebtSince") }));
        continue;
      }
      debtSince = d;
    }
    const phone = normalizePhone(phoneRaw);
    const parent = normalizePhone(parentRaw) ?? phone;
    const phones = [...new Set([phone, parent].filter((p): p is string => !!p))];

    const known = await findExisting(db, ctx.centerId, firstName, lastName, phones);
    const dupKey = `${firstName.toLowerCase()}|${lastName.toLowerCase()}|${phones.join(",")}`;
    if (dry) {
      const again = seenInDryRun.has(dupKey);
      seenInDryRun.add(dupKey);
      if (known || again) {
        const openHere = known && group ? await db.enrollment.findFirst({ where: { studentId: known.id, groupId: group.id, endDate: null }, select: { id: true } }) : null;
        if (again || !group || openHere) {
          existingRows.push(t("import.row", { n, msg: t("money.import.exists") }));
          continue;
        }
        created++;
        continue;
      }
      if (group && seats <= 0) {
        errors.push(t("import.row", { n, msg: t("plan.importFull") }));
        continue;
      }
      if (group) seats--;
      created++;
      continue;
    }

    if (!known && group && seats <= 0) {
      errors.push(t("import.row", { n, msg: t("plan.importFull") }));
      continue;
    }
    try {
      const outcome = await db.$transaction(async (tx) => {
        // look again inside the transaction: the row above may have created this student
        const existing = await findExisting(tx, ctx.centerId, firstName, lastName, phones);
        if (existing) {
          await assertFamilyAccess(ctx, existing.familyId);
          let enrolled = false;
          if (group && !(await tx.enrollment.findFirst({ where: { studentId: existing.id, groupId: group.id, endDate: null }, select: { id: true } }))) {
            const en = await tx.enrollment.create({ data: { studentId: existing.id, groupId: group.id, startDate: fromISODate(today), activatedAt: fromISODate(nextMonth), status: "ACTIVE" } });
            await billableOrRowError(tx, en.id, t);
            enrolled = true;
          }
          // never a second opening balance; a balance for a family that never had one is refused as before
          if (balance !== 0 && !(await familyHasOpening(tx, existing.familyId))) throw new Error(t("import.balanceExistingFamily"));
          if (!enrolled) return "existing" as const;
          await audit(tx, { centerId: ctx.centerId, userId: ctx.userId, entity: "Student", entityId: existing.id, action: "import", after: { row: n, group: code || null, balance: 0, existing: true } });
          return "enrolled" as const;
        }
        // a sibling joins an existing family only if this user may see that family
        let familyId: string | undefined;
        const fam = parent ? await tx.guardian.findFirst({ where: { phone: parent, family: { centerId: ctx.centerId } } }) : null;
        if (fam) {
          try {
            await assertFamilyAccess(ctx, fam.familyId);
            familyId = fam.familyId;
          } catch {
            familyId = undefined;
          }
        }
        if (familyId && balance !== 0) throw new Error(t("import.balanceExistingFamily"));
        if (!familyId) {
          const f = await tx.family.create({ data: { centerId: ctx.centerId, name: `${lastName}lar oilasi` } });
          familyId = f.id;
          if (parent) await tx.guardian.create({ data: { familyId, name: parent === phone ? `${firstName} ${lastName}` : `${lastName} (ota-ona)`, phone: parent, isPrimary: true, relation: parent === phone ? "self" : null } });
        }
        const s = await tx.student.create({ data: { centerId: ctx.centerId, familyId, branchId: group?.branchId ?? ctx.activeBranchId ?? ctx.branchIds?.[0] ?? null, firstName, lastName, phone, source: "Import" } });
        if (group) {
          const en = await tx.enrollment.create({ data: { studentId: s.id, groupId: group.id, startDate: fromISODate(today), activatedAt: fromISODate(nextMonth), status: "ACTIVE" } });
          await billableOrRowError(tx, en.id, t);
        }
        if (balance !== 0) {
          await tx.ledgerEntry.create({
            data: {
              centerId: ctx.centerId,
              familyId,
              studentId: s.id,
              type: balance < 0 ? "CHARGE" : "CREDIT",
              amount: balance,
              method: "SYSTEM",
              period: OPENING_PERIOD,
              description: t("import.opening"),
              date: fromISODate(balance < 0 ? debtSince : today),
              createdById: ctx.userId,
            },
          });
        }
        await audit(tx, { centerId: ctx.centerId, userId: ctx.userId, entity: "Student", entityId: s.id, action: "import", after: { row: n, group: code || null, balance, debtSince: balance < 0 ? debtSince : null } });
        return "created" as const;
      });
      if (outcome === "existing") existingRows.push(t("import.row", { n, msg: t("money.import.exists") }));
      else {
        created++;
        if (outcome === "created" && group) seats--;
      }
    } catch (e) {
      const msg = e instanceof UserError ? t(e.key, e.vars) : String((e as Error).message);
      errors.push(t("import.row", { n, msg: msg.slice(0, 120) }));
    }
  }
  const summary = dry ? t("import.checked", { ok: created, errors: errors.length }) : t("import.result", { rows: rows.length, created, errors: errors.length });
  const lines = [summary, ...(existingRows.length ? [t("money.import.skipped", { n: existingRows.length })] : []), ...errors.slice(0, 30), ...existingRows.slice(0, 30)];
  return { message: lines.join("\n"), created, existing: existingRows.length, errors };
}
