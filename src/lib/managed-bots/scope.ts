// Which bot an update (or Mini App call) came through. A center's own bot speaks for that center only:
// its name and avatar belong to a client, so another center's data must never pass through it.
//
// The scope rides on AsyncLocalStorage so every read model under it is filtered without passing a
// centerId through each call: validLinks (and with it chatRoles, chatStudents, the portal, staff
// replies) and activeAgentChat read it. No scope = the shared bot = every center, as before.
import { AsyncLocalStorage } from "node:async_hooks";

export interface BotScope {
  centerId: string;
  botId: string;
}

const als = new AsyncLocalStorage<BotScope>();

/** Run `fn` as the center bot `scope`; null = the shared bot: no filter, even inside another scope. */
export function withBotScope<T>(scope: BotScope | null, fn: () => T): T {
  return scope ? als.run(scope, fn) : als.exit(fn);
}

/** The center the current update is scoped to, or null in the shared bot. */
export function scopedCenterId(): string | null {
  return als.getStore()?.centerId ?? null;
}

export function currentBotScope(): BotScope | null {
  return als.getStore() ?? null;
}
