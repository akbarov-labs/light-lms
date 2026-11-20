// Telegram chat links: who a chat speaks for. A link is only valid while the person still has the
// phone the chat proved (contact share), is active, and their center is enabled.
// Unlink in the SAME transaction as the change that breaks the link (phone change, staff archived).
import type { LinkKind } from "@/generated/prisma/client";
import { db, type Tx } from "./db";
import { normalizePhone } from "./phone";
import { scopedCenterId } from "./managed-bots/scope";

async function clearChatId(tx: Tx, kind: LinkKind, refIds: string[], chatId?: string) {
  if (refIds.length === 0) return;
  const where = { id: { in: refIds }, ...(chatId ? { telegramChatId: chatId } : {}) };
  if (kind === "GUARDIAN") await tx.guardian.updateMany({ where, data: { telegramChatId: null } });
  else if (kind === "STUDENT") await tx.student.updateMany({ where, data: { telegramChatId: null } });
  else await tx.user.updateMany({ where, data: { telegramChatId: null } });
}

/** Forget every chat linked to this person and clear their telegramChatId. Returns removed links. */
export async function unlinkRef(tx: Tx, kind: LinkKind, refId: string): Promise<number> {
  const r = await tx.telegramLink.deleteMany({ where: { kind, refId } });
  await clearChatId(tx, kind, [refId]);
  return r.count;
}

/** Forget everything this chat is linked to (e.g. the chat blocked the bot). Returns removed links. */
export async function unlinkChat(tx: Tx, chatId: string): Promise<number> {
  const r = await tx.telegramLink.deleteMany({ where: { chatId } });
  await tx.guardian.updateMany({ where: { telegramChatId: chatId }, data: { telegramChatId: null } });
  await tx.student.updateMany({ where: { telegramChatId: chatId }, data: { telegramChatId: null } });
  await tx.user.updateMany({ where: { telegramChatId: chatId }, data: { telegramChatId: null } });
  return r.count;
}

/** Phone of a person changed (or was removed): the chat that proved the old phone loses access. */
export async function unlinkIfPhoneChanged(tx: Tx, kind: LinkKind, refId: string, oldPhone: string | null | undefined, newPhone: string | null | undefined): Promise<boolean> {
  if ((normalizePhone(oldPhone) ?? oldPhone ?? null) === (normalizePhone(newPhone) ?? newPhone ?? null)) return false;
  await unlinkRef(tx, kind, refId);
  return true;
}

export interface ValidLinks {
  /** Guardian/student ids this chat may still speak for. */
  guardianIds: string[];
  studentIds: string[];
  /** Active staff (not archived, center enabled, phone unchanged). */
  staffIds: string[];
}

/**
 * Re-check a chat's links on every bot update: drop links whose person changed phone, was archived
 * (staff) or whose center is disabled. Stale links (phone changed / person gone) are deleted; links
 * of a disabled center are only ignored, so they work again when the center is switched back on.
 * Inside a center bot's scope (managed bots) only that center's people are returned; stale links of any
 * center are still cleaned up.
 */
export async function validLinks(chatId: string, client: Tx = db): Promise<ValidLinks> {
  const links = await client.telegramLink.findMany({ where: { chatId } });
  const ids = (k: LinkKind) => links.filter((l) => l.kind === k).map((l) => l.refId);
  const [guardians, students, users] = await Promise.all([
    client.guardian.findMany({ where: { id: { in: ids("GUARDIAN") } }, select: { id: true, phone: true, family: { select: { centerId: true, center: { select: { disabledAt: true } } } } } }),
    client.student.findMany({ where: { id: { in: ids("STUDENT") } }, select: { id: true, phone: true, centerId: true, center: { select: { disabledAt: true } } } }),
    client.user.findMany({ where: { id: { in: ids("STAFF") } }, select: { id: true, phone: true, archivedAt: true, centerId: true, center: { select: { disabledAt: true } } } }),
  ]);
  const people = new Map<string, { phone: string | null; disabled: boolean; archived: boolean; centerId: string }>([
    ...guardians.map((g) => [`GUARDIAN:${g.id}`, { phone: g.phone, disabled: !!g.family.center.disabledAt, archived: false, centerId: g.family.centerId }] as const),
    ...students.map((s) => [`STUDENT:${s.id}`, { phone: s.phone, disabled: !!s.center.disabledAt, archived: false, centerId: s.centerId }] as const),
    ...users.map((u) => [`STAFF:${u.id}`, { phone: u.phone, disabled: !!u.center.disabledAt, archived: !!u.archivedAt, centerId: u.centerId }] as const),
  ]);
  const scope = scopedCenterId();
  const out: ValidLinks = { guardianIds: [], studentIds: [], staffIds: [] };
  const stale: typeof links = [];
  for (const l of links) {
    const p = people.get(`${l.kind}:${l.refId}`);
    if (!p || normalizePhone(p.phone) !== normalizePhone(l.phone) || p.archived) {
      stale.push(l);
      continue;
    }
    if (p.disabled || (scope && p.centerId !== scope)) continue;
    (l.kind === "GUARDIAN" ? out.guardianIds : l.kind === "STUDENT" ? out.studentIds : out.staffIds).push(l.refId);
  }
  if (stale.length) {
    await client.telegramLink.deleteMany({ where: { id: { in: stale.map((l) => l.id) } } });
    for (const kind of ["GUARDIAN", "STUDENT", "STAFF"] as const) {
      await clearChatId(client, kind, stale.filter((l) => l.kind === kind).map((l) => l.refId), chatId);
    }
  }
  return out;
}
