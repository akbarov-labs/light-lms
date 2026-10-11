"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { BRANCH_COOKIE, getCtx } from "@/lib/ctx";
import { isLocale, LANG_COOKIE } from "@/lib/i18n";
import { SESSION_COOKIE } from "@/lib/session";
import { db } from "@/lib/db";

const YEAR = 60 * 60 * 24 * 365;

export async function setBranchAction(fd: FormData) {
  const jar = await cookies();
  const id = String(fd.get("branchId") ?? "");
  if (id) jar.set(BRANCH_COOKIE, id, { path: "/", httpOnly: true, sameSite: "lax", maxAge: YEAR });
  else jar.delete(BRANCH_COOKIE);
  revalidatePath("/", "layout");
}

export async function setLangAction(fd: FormData) {
  const lang = String(fd.get("lang") ?? "");
  if (!isLocale(lang)) return;
  const jar = await cookies();
  jar.set(LANG_COOKIE, lang, { path: "/", sameSite: "lax", maxAge: YEAR });
  const ctx = await getCtx();
  if (ctx) await db.user.update({ where: { id: ctx.userId }, data: { locale: lang } });
  revalidatePath("/", "layout");
}

export async function logoutAction() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  jar.delete(BRANCH_COOKIE);
  redirect("/login");
}
