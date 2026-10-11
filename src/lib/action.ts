import "server-only";
import { unstable_rethrow } from "next/navigation";
import { ZodError } from "zod";
import { actionCtx, getCtx, UserError, type Ctx } from "./ctx";
import { makeT } from "./i18n";
import type { Perm } from "./perms";

export type ActionState = { ok?: boolean; error?: string; message?: string; at?: number } | null;

/**
 * Wrap a server action body: loads the context (session + permission), turns expected errors
 * into a message the form can show, and lets Next's redirect()/notFound() through.
 */
export async function runAction(perm: Perm | undefined, fn: (ctx: Ctx) => Promise<ActionState | void>): Promise<ActionState> {
  try {
    const ctx = await actionCtx(perm);
    const res = await fn(ctx);
    return { ok: true, at: Date.now(), ...(res ?? {}) };
  } catch (e) {
    unstable_rethrow(e);
    const ctx = await getCtx().catch(() => null);
    const t = ctx?.t ?? makeT("uz");
    if (e instanceof UserError) return { error: t(e.key, e.vars), at: Date.now() };
    if (e instanceof ZodError) {
      const details = e.issues.map((i) => `${i.path.join(".") || "?"}: ${i.message}`).join("; ");
      return { error: t("error.invalid", { details }), at: Date.now() };
    }
    console.error("[action]", e);
    return { error: t("error.generic"), at: Date.now() };
  }
}
