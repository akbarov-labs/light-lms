// Student CSV import (HANDOFF §17), framework-free so it can be tested on the database.
// Idempotent: importing the same file again creates no student, enrollment or opening balance twice.
import { db, type Tx } from "@/lib/db";
import { audit } from "@/lib/audit";
import { assertFamilyAccess, canAccessBranch, UserError, type Ctx } from "@/lib/ctx-core";
import { parseCsv } from "@/lib/csv-parse";
import { normalizePhone } from "@/lib/phone";
import { formatMoney, MAX_AMOUNT, parseMoney } from "@/lib/money";
import { fromISODate, monthRange, shiftMonth, toISODate, todayISO, type ISODate } from "@/lib/dates";
import { makeT } from "@/lib/i18n";
import { centerUsage } from "@/lib/services/plan-usage";
import { assertBillable } from "@/lib/services/enrollments";
import { debtSinceColumn, gradeColumn, parseGrade, parseImportDate } from "./import-parse";
import { renewalAnchor } from "@/lib/billing/engine";
import { nextPeriodStart, periodContaining } from "@/lib/billing/periods";

/** Marker of an opening balance on LedgerEntry.period (no billingKey: it is not an engine unit). */
export const OPENING_PERIOD = "opening";

/** Student.source of imported rows. */
const IMPORT_SOURCE = "Import";

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

const nameWhere = (firstName: string, lastName: string) => ({
  firstName: { equals: firstName, mode: "insensitive" as const },
  lastName: { equals: lastName, mode: "insensitive" as const },
});

/**
 * The student this row describes, if already in the center: same first + last name (any case) and
 * the same phone (student's own, or a guardian's of their family).
 * Without any phone a name alone is no identity (two "Ali Valiyev" are common), so only a true
 * re-import of the same row matches — a phoneless student of a guardian-less family who still has
 * an open enrollment in the row's group; for a row without a group, a phoneless imported student
 * with no enrollment whose opening balance is the row's. Anything else becomes a new student.
 */
async function findExisting(tx: Tx, centerId: string, row: { firstName: string; lastName: string; phones: string[]; groupId: string | null; balance: number }) {
  const name = nameWhere(row.firstName, row.lastName);
  const select = { id: true, familyId: true } as const;
  if (row.phones.length) {
    const where = { centerId, ...name, OR: [{ phone: { in: row.phones } }, { family: { guardians: { some: { phone: { in: row.phones } } } } }] };
    return tx.student.findFirst({ where, orderBy: { createdAt: "asc" }, select });
  }
  const phoneless = { centerId, ...name, phone: null, family: { guardians: { none: {} } } };
  if (row.groupId) {
    return tx.student.findFirst({ where: { ...phoneless, enrollments: { some: { groupId: row.groupId, endDate: null } } }, orderBy: { createdAt: "asc" }, select });
  }
  const candidates = await tx.student.findMany({
    where: { ...phoneless, source: IMPORT_SOURCE, enrollments: { none: {} } },
    orderBy: { createdAt: "asc" },
    select: { ...select, ledger: { where: { period: OPENING_PERIOD }, select: { amount: true } } },
  });
  const same = candidates.find((c) => c.ledger.reduce((s, x) => s + x.amount, 0) === row.balance);
  return same ? { id: same.id, familyId: same.familyId } : null;
}

export interface ImportResult {
  message: string;
  created: number;
  existing: number;
  errors: string[];
  /** Rows imported anyway that may duplicate a student (same name, no phone to tell them apart). */
  warnings: string[];
}

export async function importStudents(ctx: Ctx, text: string, dry: boolean): Promise<ImportResult> {
  const { t } = ctx;
  const rows = parseCsv(text);
  let header: string[] | null = null;
  if (rows.length && !/^[-−–]?[\d\s,.'  ]*$/.test(rows[0][5] ?? "0") && !/^\d+$/.test((rows[0][4] ?? "").replace("#", ""))) header = rows.shift() ?? null;
  const sinceCol = debtSinceColumn(header);
  const gradeCol = gradeColumn(header);
  const groups = await db.group.findMany({ where: { centerId: ctx.centerId }, select: { id: true, code: true, branchId: true, startDate: true, course: { select: { renewal: true, renewalDay: true } } } });
  const byCode = new Map(groups.map((g) => [String(g.code), g]));
  const today = todayISO();
  const nextMonth = monthRange(shiftMonth(today.slice(0, 7), 1)).start;
  // billing starts with the group's next billing month (the 1st, or e.g. the 15th for a course billed from the 15th)
  const firstBilled = (g: (typeof groups)[number]): ISODate => {
    if (g.course.renewal === "STUDENT_START") return nextMonth;
    const anchor = renewalAnchor(g.course, toISODate(g.startDate), today);
    return nextPeriodStart(periodContaining(today, anchor).start, anchor);
  };
  const errors: string[] = [];
  const warnings: string[] = [];
  const existingRows: string[] = [];
  let created = 0;
  // plan limit: each imported row with a group becomes a new active student
  let seats = (await centerUsage(ctx.centerId)).remaining;
  const seenRows = new Set<string>();

  for (const [i, r] of rows.entries()) {
    const n = i + 1;
    const [lastName, firstName, phoneRaw, parentRaw, codeRaw, balanceRaw] = r;
    const sinceRaw = r[sinceCol] ?? "";
    const grade = gradeCol >= 0 ? parseGrade(r[gradeCol]) : null;
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
    // same ceiling as every money form: a pasted account number must not become a balance
    if (Math.abs(balance) > MAX_AMOUNT) {
      errors.push(t("import.row", { n, msg: t("money.import.balanceTooLarge", { max: formatMoney(MAX_AMOUNT) }) }));
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

    const identity = { firstName, lastName, phones, groupId: group?.id ?? null, balance };
    const known = await findExisting(db, ctx.centerId, identity);
    // without a phone the row's group and balance are part of what makes it "the same row"
    const dupKey = `${firstName.toLowerCase()}|${lastName.toLowerCase()}|${phones.join(",")}${phones.length ? "" : `|${code}|${balance}`}`;
    const again = seenRows.has(dupKey);
    seenRows.add(dupKey);
    if (!phones.length && !known && !again && (await db.student.findFirst({ where: { centerId: ctx.centerId, ...nameWhere(firstName, lastName) }, select: { id: true } }))) {
      warnings.push(t("import.row", { n, msg: t("money.import.possibleDuplicate", { name: `${lastName} ${firstName}` }) }));
    }
    if (dry) {
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
        const existing = await findExisting(tx, ctx.centerId, identity);
        if (existing) {
          await assertFamilyAccess(ctx, existing.familyId);
          // a grade fills an empty one; it never overwrites what staff typed
          if (grade) await tx.student.updateMany({ where: { id: existing.id, schoolGrade: null }, data: { schoolGrade: grade } });
          let enrolled = false;
          if (group && !(await tx.enrollment.findFirst({ where: { studentId: existing.id, groupId: group.id, endDate: null }, select: { id: true } }))) {
            const en = await tx.enrollment.create({ data: { studentId: existing.id, groupId: group.id, startDate: fromISODate(today), activatedAt: fromISODate(firstBilled(group)), status: "ACTIVE" } });
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
        const s = await tx.student.create({ data: { centerId: ctx.centerId, familyId, branchId: group?.branchId ?? ctx.activeBranchId ?? ctx.branchIds?.[0] ?? null, firstName, lastName, phone, schoolGrade: grade, source: IMPORT_SOURCE } });
        if (group) {
          const en = await tx.enrollment.create({ data: { studentId: s.id, groupId: group.id, startDate: fromISODate(today), activatedAt: fromISODate(firstBilled(group)), status: "ACTIVE" } });
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
  const lines = [summary, ...(existingRows.length ? [t("money.import.skipped", { n: existingRows.length })] : []), ...errors.slice(0, 30), ...warnings.slice(0, 30), ...existingRows.slice(0, 30)];
  return { message: lines.join("\n"), created, existing: existingRows.length, errors, warnings };
}
