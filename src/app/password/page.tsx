import Link from "next/link";
import { requireCtxForPasswordChange } from "@/lib/ctx";
import { db } from "@/lib/db";
import { logoutAction } from "@/app/actions";
import { AuthCard } from "../login/auth-card";
import { PasswordForm } from "./form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Parol" };

export default async function PasswordPage() {
  const ctx = await requireCtxForPasswordChange();
  const { t } = ctx;
  const user = await db.user.findUniqueOrThrow({ where: { id: ctx.userId }, select: { mustChangePassword: true } });
  const forced = user.mustChangePassword;
  return (
    <AuthCard
      title={forced ? t("auth.changeTitle") : t("auth.changeOwn")}
      subtitle={ctx.userName}
      footer={
        <div className="mt-4 flex justify-center gap-4 text-sm">
          {!forced && <Link href={ctx.role === "TEACHER" ? "/t" : "/"} className="text-zinc-600 underline-offset-4 hover:text-zinc-900 hover:underline">{t("common.back")}</Link>}
          <form action={logoutAction}>
            <button className="text-zinc-600 underline-offset-4 hover:text-zinc-900 hover:underline">{t("common.logout")}</button>
          </form>
        </div>
      }
    >
      {forced && <p className="mb-4 text-sm text-zinc-600">{t("auth.changeIntro")}</p>}
      <PasswordForm forced={forced} labels={{ current: t("auth.currentPassword"), password: t("auth.newPassword"), repeat: t("auth.repeatPassword"), submit: t("auth.setPassword") }} />
    </AuthCard>
  );
}
