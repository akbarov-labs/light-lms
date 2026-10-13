import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { formatMoney, parseMoney } from "@/lib/money";
import { accentVars } from "@/lib/color";
import { buildPayLink } from "@/lib/payments/payme";
import { familyBalance } from "@/lib/services/wallet";

export const dynamic = "force-dynamic";

/** Public pay page behind every Telegram pay link: shows the debt and opens Payme checkout. */
export default async function PayPage({ params, searchParams }: { params: Promise<{ familyId: string }>; searchParams: Promise<{ amount?: string; go?: string; lang?: string }> }) {
  const { familyId } = await params;
  const sp = await searchParams;
  const family = await db.family.findUnique({ where: { id: familyId }, include: { center: true, students: { where: { status: "ACTIVE" }, select: { firstName: true } } } });
  if (!family || !family.center.paymeMerchantId || !family.center.paymeKey) notFound();
  const ru = sp.lang === "ru";
  const balance = await familyBalance(familyId);
  const debt = balance < 0 ? -balance : 0;
  const amount = parseMoney(sp.amount ?? "") ?? debt;
  const appUrl = (process.env.APP_URL ?? "").replace(/\/$/, "");
  if (sp.go && amount >= 1000) {
    redirect(buildPayLink({ merchantId: family.center.paymeMerchantId, familyId, amountTiyin: amount * 100, returnUrl: `${appUrl}/pay/${familyId}`, lang: ru ? "ru" : "uz", test: family.center.paymeTestMode }));
  }
  return (
    <main style={accentVars(family.center.accentColor) as React.CSSProperties} className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-6 text-center shadow-xs">
        <div className="text-lg font-semibold">{family.center.name}</div>
        <div className="text-sm text-zinc-500">{family.students.map((s) => s.firstName).join(", ")}</div>
        <div className="my-5">
          <div className="text-xs uppercase text-zinc-500">{ru ? "К оплате" : "To'lov summasi"}</div>
          <div className="text-3xl font-bold">{formatMoney(debt, ru ? "сум" : "so'm")}</div>
        </div>
        <form className="space-y-3">
          <input type="hidden" name="go" value="1" />
          {sp.lang && <input type="hidden" name="lang" value={sp.lang} />}
          <input name="amount" inputMode="numeric" defaultValue={amount || ""} placeholder="100 000" className="block w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-center text-lg" required />
          <button className="w-full rounded-lg bg-[#00CCCC] py-3 font-semibold text-white">{ru ? "Оплатить через Payme" : "Payme orqali to'lash"}</button>
        </form>
        {family.center.paymeTestMode && <p className="mt-3 text-xs text-amber-700">TEST</p>}
      </div>
    </main>
  );
}
