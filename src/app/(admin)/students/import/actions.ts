"use server";

import { runAction, type ActionState } from "@/lib/action";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { assertFamilyAccess, canAccessBranch } from "@/lib/ctx";
import { parseCsv } from "@/lib/csv-parse";
import { normalizePhone } from "@/lib/phone";
import { parseMoney } from "@/lib/money";
import { fromISODate, monthRange, shiftMonth, todayISO } from "@/lib/dates";
import { centerUsage } from "@/lib/services/plan-usage";

/** Import students from CSV (HANDOFF §17). One transaction per row so a bad row never blocks the rest. */
export async function importStudentsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("students.edit", async (ctx) => {
    const { t } = ctx;
    const file = fd.get("file");
    const text = file instanceof File && file.size > 0 ? await file.text() : String(fd.get("text") ?? "");
    const dry = fd.get("dryRun") === "on";
    const rows = parseCsv(text);
    if (rows.length && !/^-?[\d\s,.']*$/.test(rows[0][5] ?? "0") && !/^\d+$/.test((rows[0][4] ?? "").replace("#", ""))) rows.shift(); // header
    const groups = await db.group.findMany({ where: { centerId: ctx.centerId }, select: { id: true, code: true, branchId: true } });
    const byCode = new Map(groups.map((g) => [String(g.code), g]));
    const nextMonth = monthRange(shiftMonth(todayISO().slice(0, 7), 1)).start;
    const errors: string[] = [];
    let created = 0;
    // plan limit: each imported row with a group becomes a new active student
    let seats = (await centerUsage(ctx.centerId)).remaining;
    for (const [i, r] of rows.entries()) {
      const n = i + 1;
      const [lastName, firstName, phoneRaw, parentRaw, codeRaw, balanceRaw] = r;
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
      if (group && seats <= 0) {
        errors.push(t("import.row", { n, msg: t("plan.importFull") }));
        continue;
      }
      const phone = normalizePhone(phoneRaw);
      const parent = normalizePhone(parentRaw) ?? phone;
      if (dry) {
        if (group) seats--;
        created++;
        continue;
      }
      try {
        await db.$transaction(async (tx) => {
          // a sibling joins an existing family only if this user may see that family
          let familyId: string | undefined;
          const known = parent ? await tx.guardian.findFirst({ where: { phone: parent, family: { centerId: ctx.centerId } } }) : null;
          if (known) {
            try {
              await assertFamilyAccess(ctx, known.familyId);
              familyId = known.familyId;
            } catch {
              familyId = undefined;
            }
          }
          if (familyId && balance !== 0) throw new Error(t("import.balanceExistingFamily"));
          if (!familyId) {
            const fam = await tx.family.create({ data: { centerId: ctx.centerId, name: `${lastName}lar oilasi` } });
            familyId = fam.id;
            if (parent) await tx.guardian.create({ data: { familyId, name: parent === phone ? `${firstName} ${lastName}` : `${lastName} (ota-ona)`, phone: parent, isPrimary: true, relation: parent === phone ? "self" : null } });
          }
          const s = await tx.student.create({ data: { centerId: ctx.centerId, familyId, branchId: group?.branchId ?? ctx.activeBranchId ?? ctx.branchIds?.[0] ?? null, firstName, lastName, phone, source: "Import" } });
          if (group) {
            const open = await tx.enrollment.findFirst({ where: { studentId: s.id, groupId: group.id, endDate: null } });
            if (!open) await tx.enrollment.create({ data: { studentId: s.id, groupId: group.id, startDate: fromISODate(todayISO()), activatedAt: fromISODate(nextMonth), status: "ACTIVE" } });
          }
          if (balance !== 0) {
            await tx.ledgerEntry.create({
              data: { centerId: ctx.centerId, familyId, studentId: s.id, type: balance < 0 ? "CHARGE" : "CREDIT", amount: balance, method: "SYSTEM", description: t("import.opening"), date: fromISODate(todayISO()), createdById: ctx.userId },
            });
          }
          await audit(tx, { centerId: ctx.centerId, userId: ctx.userId, entity: "Student", entityId: s.id, action: "import", after: { row: n, group: code || null, balance } });
        });
        created++;
        if (group) seats--;
      } catch (e) {
        errors.push(t("import.row", { n, msg: String((e as Error).message).slice(0, 120) }));
      }
    }
    const summary = dry ? t("import.checked", { ok: created, errors: errors.length }) : t("import.result", { rows: rows.length, created, errors: errors.length });
    return { message: [summary, ...errors.slice(0, 30)].join("\n") };
  });
}
