import Link from "next/link";
import { cookies } from "next/headers";
import { isLocale, LANG_COOKIE, makeT } from "@/lib/i18n";
import { telegramEnabled } from "@/lib/telegram";
import { ResetForm } from "../form";
import { AuthCard } from "../auth-card";

export const metadata = { title: "Parolni tiklash" };

export default async function ResetPage() {
  const lang = (await cookies()).get(LANG_COOKIE)?.value;
  const t = makeT(isLocale(lang) ? lang : "uz");
  return (
    <AuthCard
      title={t("auth.resetTitle")}
      footer={
        <div className="mt-4 text-center">
          <Link href="/login" className="text-sm text-zinc-600 underline-offset-4 hover:text-zinc-900 hover:underline">{t("auth.backToLogin")}</Link>
        </div>
      }
    >
      {telegramEnabled() ? (
        <ResetForm
          labels={{
            intro: t("auth.resetIntro"),
            phone: t("auth.phone"),
            sendCode: t("auth.sendCode"),
            code: t("auth.code"),
            newPassword: t("auth.newPassword"),
            repeatPassword: t("auth.repeatPassword"),
            setPassword: t("auth.setPassword"),
            haveCode: t("auth.haveCode"),
          }}
        />
      ) : (
        <p className="text-sm text-zinc-600">{t("auth.resetNoBot")}</p>
      )}
      {telegramEnabled() && <p className="mt-4 border-t border-zinc-100 pt-4 text-xs text-zinc-500">{t("auth.resetNoBot")}</p>}
    </AuthCard>
  );
}
