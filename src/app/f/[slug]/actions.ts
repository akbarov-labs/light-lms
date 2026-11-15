"use server";

import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { normalizePhone } from "@/lib/phone";
import { makeT, isLocale } from "@/lib/i18n";
import { audit } from "@/lib/audit";
import { headers } from "next/headers";
import { dbAttemptStore } from "@/lib/auth/attempts-db";
import { attemptKey, checkAttempts, recordAttempt, retryMinutes, RULES } from "@/lib/auth/ratelimit";
import { clientIp } from "@/lib/auth/security";

export type PublicLeadState = { ok?: boolean; error?: string } | null;

const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"];

/** Public lead form (no login). A repeat from the same phone becomes a note on the open lead. */
export async function submitLeadAction(_: PublicLeadState, fd: FormData): Promise<PublicLeadState> {
  const lang = String(fd.get("lang") ?? "uz");
  const t = makeT(isLocale(lang) ? lang : "uz");
  if (String(fd.get("website") ?? "") !== "") return { ok: true }; // honeypot
  const key = attemptKey.leadIp(clientIp(await headers()));
  const verdict = await checkAttempts(dbAttemptStore, [{ key, rule: RULES.leadIp }]);
  if (!verdict.allowed) return { error: t("leads.tooMany", { minutes: retryMinutes(verdict.retryAfterMs) }) };
  await recordAttempt(dbAttemptStore, [key], false); // every submission spends the address's hourly budget
  const slug = String(fd.get("slug") ?? "");
  const center = await db.center.findUnique({ where: { slug }, select: { id: true, disabledAt: true } });
  if (!center || center.disabledAt) return { error: t("leads.notFound") };
  const name = String(fd.get("name") ?? "").trim().slice(0, 120);
  const phone = normalizePhone(String(fd.get("phone") ?? ""));
  if (!name) return { error: t("error.invalid", { details: t("leads.formName") }) };
  if (!phone) return { error: t("error.phone") };
  const courseId = String(fd.get("courseId") ?? "") || null;
  const course = courseId ? await db.course.findFirst({ where: { id: courseId, centerId: center.id }, select: { id: true } }) : null;
  const comment = String(fd.get("comment") ?? "").trim().slice(0, 1000);
  const utm: Record<string, string> = {};
  for (const k of UTM_KEYS) {
    const v = String(fd.get(k) ?? "").trim().slice(0, 120);
    if (v) utm[k] = v;
  }
  await db.$transaction(async (tx) => {
    const open = await tx.lead.findFirst({ where: { centerId: center.id, phone, archivedAt: null, stage: { notIn: ["ENROLLED", "LOST"] } } });
    if (open) {
      await tx.leadNote.create({ data: { leadId: open.id, text: `↻ ${name}${comment ? `: ${comment}` : ""}`, actor: "PUBLIC" } });
      return;
    }
    const lead = await tx.lead.create({
      data: {
        centerId: center.id,
        name,
        phone,
        courseId: course?.id ?? null,
        source: utm.utm_source ?? t("leads.formSource"),
        utm: Object.keys(utm).length ? (utm as Prisma.InputJsonValue) : undefined,
        nextContactAt: new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z"),
      },
    });
    if (comment) await tx.leadNote.create({ data: { leadId: lead.id, text: comment, actor: "PUBLIC" } });
    await audit(tx, { centerId: center.id, userId: null, actor: "PUBLIC", entity: "Lead", entityId: lead.id, action: "create.public", after: { name, phone, utm } });
  });
  return { ok: true };
}
