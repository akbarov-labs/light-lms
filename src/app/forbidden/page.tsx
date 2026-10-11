import Link from "next/link";
import { getCtx } from "@/lib/ctx";
import { makeT } from "@/lib/i18n";

export default async function Forbidden() {
  const ctx = await getCtx();
  const t = ctx?.t ?? makeT("uz");
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 px-4 text-center">
      <div className="text-5xl">🔒</div>
      <h1 className="text-lg font-semibold">{t("error.forbidden")}</h1>
      <Link href="/" className="text-sm text-accent underline">{t("common.back")}</Link>
    </main>
  );
}
