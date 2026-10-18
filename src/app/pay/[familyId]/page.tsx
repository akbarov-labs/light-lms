import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { formatMoney, parseMoney } from "@/lib/money";
import { accentVars } from "@/lib/color";
import { buildPayLink } from "@/lib/payments/payme";
import { buildClickLink } from "@/lib/payments/click";
import { buildUzumLink } from "@/lib/payments/uzum";
import { enabledProviders, type ProviderCode } from "@/lib/payments/provider";
import { familyBalance } from "@/lib/services/wallet";
import { appUrl as envAppUrl } from "@/lib/env";

export const dynamic = "force-dynamic";

const LABEL: Record<ProviderCode, { uz: string; ru: string; color: string }> = {
  PAYME: { uz: "Payme orqali to'lash", ru: "Оплатить через Payme", color: "bg-[#00CCCC]" },
  CLICK: { uz: "Click orqali to'lash", ru: "Оплатить через Click", color: "bg-[#0099FF]" },
  UZUM: { uz: "Uzum Bank orqali to'lash", ru: "Оплатить через Uzum Bank", color: "bg-[#7000FF]" },
};

/** `go=1` is the pre-v2 Payme button (links already sent to parents keep working). */
function pickProvider(go: string | undefined, enabled: ProviderCode[]): ProviderCode | null {
  if (!go) return null;
  const want: ProviderCode | null = go === "1" || go === "payme" ? "PAYME" : go === "click" ? "CLICK" : go === "uzum" ? "UZUM" : null;
  return want && enabled.includes(want) ? want : null;
}

/** Public pay page behind every pay link: shows the debt and opens the chosen provider's checkout. */
export default async function PayPage({ params, searchParams }: { params: Promise<{ familyId: string }>; searchParams: Promise<{ amount?: string; go?: string; lang?: string }> }) {
  const { familyId } = await params;
  const sp = await searchParams;
  const family = await db.family.findUnique({ where: { id: familyId }, include: { center: true, students: { where: { status: "ACTIVE" }, select: { firstName: true } } } });
  if (!family || family.center.disabledAt) notFound();
  const c = family.center;
  const enabled = enabledProviders(c);
  if (enabled.length === 0) notFound();
  const ru = sp.lang === "ru";
  const balance = await familyBalance(familyId);
  const debt = balance < 0 ? -balance : 0;
  // "300 000,00" is 300 000 (never ×100); anything that is not a clean positive amount falls back to the debt
  const typed = parseMoney(sp.amount ?? "");
  const amount = typed !== null && typed > 0 ? typed : debt;
  const returnUrl = `${envAppUrl()}/pay/${familyId}`;
  const provider = pickProvider(sp.go, enabled);
  if (provider && amount >= 1000) {
    if (provider === "PAYME") redirect(buildPayLink({ merchantId: c.paymeMerchantId!, familyId, amountTiyin: amount * 100, returnUrl, lang: ru ? "ru" : "uz", test: c.paymeTestMode }));
    if (provider === "CLICK") redirect(buildClickLink({ serviceId: c.clickServiceId!, merchantId: c.clickMerchantId!, familyId, amount, returnUrl }));
    redirect(buildUzumLink({ serviceId: c.uzumServiceId!, familyId, amount }));
  }
  return (
    <main style={accentVars(c.accentColor) as React.CSSProperties} className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-6 text-center shadow-xs">
        <div className="text-lg font-semibold">{c.name}</div>
        <div className="text-sm text-zinc-500">{family.students.map((s) => s.firstName).join(", ")}</div>
        <div className="my-5">
          <div className="text-xs uppercase text-zinc-500">{ru ? "К оплате" : "To'lov summasi"}</div>
          <div className="text-3xl font-bold">{formatMoney(debt, ru ? "сум" : "so'm")}</div>
        </div>
        <form className="space-y-3">
          {sp.lang && <input type="hidden" name="lang" value={sp.lang} />}
          <label className="sr-only" htmlFor="pay-amount">{ru ? "Сумма" : "Summa"}</label>
          <input id="pay-amount" name="amount" inputMode="numeric" defaultValue={amount || ""} placeholder="100 000" className="block w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-center text-lg" required />
          {enabled.map((p) => (
            <button key={p} name="go" value={p.toLowerCase()} className={`w-full rounded-lg py-3 font-semibold text-white ${LABEL[p].color}`}>
              {ru ? LABEL[p].ru : LABEL[p].uz}
            </button>
          ))}
        </form>
        {enabled.includes("PAYME") && c.paymeTestMode && <p className="mt-3 text-xs text-amber-700">Payme: TEST</p>}
      </div>
    </main>
  );
}
