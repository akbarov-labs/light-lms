// A certificate as printed (A4 landscape) — server component; the QR code points at /v/<code>.
import QRCode from "qrcode";
import type { TFn } from "@/lib/i18n";
import { formatDate, toISODate } from "@/lib/dates";

export interface CertificateViewData {
  center: string;
  logoUrl: string | null;
  student: string;
  title: string;
  level: string | null;
  score: number | null;
  maxScore: number | null;
  number: string;
  issuedAt: Date;
  code: string;
  verifyUrl: string;
  revokedAt: Date | null;
}

export async function CertificateView({ c, t }: { c: CertificateViewData; t: TFn }) {
  const qr = await QRCode.toString(c.verifyUrl, { type: "svg", margin: 0, errorCorrectionLevel: "M" });
  return (
    <article className="relative mx-auto aspect-[297/210] w-full max-w-4xl overflow-hidden rounded-xl border-[10px] border-double border-zinc-300 bg-white p-8 text-center shadow-xs sm:p-12 print:max-w-none print:rounded-none print:shadow-none">
      {c.revokedAt && (
        <div className="absolute inset-0 z-10 flex items-center justify-center" aria-hidden>
          <span className="-rotate-12 rounded-lg border-4 border-red-600 px-6 py-2 text-3xl font-bold uppercase tracking-widest text-red-600 opacity-80">{t("cert.revoked")}</span>
        </div>
      )}
      <div className="flex h-full flex-col">
        <div className="text-sm font-medium tracking-wide text-zinc-500">
          {/* eslint-disable-next-line @next/next/no-img-element -- the center's own logo URL, any host (same as the lead form) */}
          {c.logoUrl ? <img src={c.logoUrl} alt="" className="mx-auto mb-2 h-12 w-auto" /> : null}
          {c.center}
        </div>
        <h1 className="mt-4 text-4xl font-semibold tracking-[0.3em] text-zinc-900 sm:text-5xl">{t("cert.heading")}</h1>
        <p className="mt-6 text-sm text-zinc-600">{t("cert.statement")}</p>
        <p className="mt-2 text-3xl font-semibold text-zinc-950 sm:text-4xl">{c.student}</p>
        <p className="mx-auto mt-3 max-w-xl text-base text-zinc-700">{t("cert.statementEnd", { title: c.title })}</p>
        {(c.level || c.score !== null) && (
          <p className="mt-3 text-sm text-zinc-700">
            {c.level && <>{t("cert.level")}: <b>{c.level}</b></>}
            {c.level && c.score !== null && " · "}
            {c.score !== null && <>{t("cert.score")}: <b className="tnum">{c.score}{c.maxScore ? ` / ${c.maxScore}` : ""}</b></>}
          </p>
        )}
        <div className="mt-auto flex items-end justify-between gap-6 pt-6 text-left text-xs text-zinc-600">
          <div className="space-y-1">
            <div>{t("cert.number")}: <span className="tnum font-medium text-zinc-900">{c.number}</span></div>
            <div>{t("cert.issuedAt")}: <span className="tnum font-medium text-zinc-900">{formatDate(toISODate(c.issuedAt))}</span></div>
            <div className="pt-6">______________________<br />{t("cert.director")}</div>
          </div>
          <div className="flex items-end gap-3 text-right">
            <div>
              <div>{t("cert.verifyAt")}</div>
              <div className="break-all font-mono text-zinc-900">{c.verifyUrl}</div>
              <div>{t("cert.code")}: <span className="font-mono font-medium text-zinc-900">{c.code}</span></div>
            </div>
            <div className="h-20 w-20 shrink-0 [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: qr }} />
          </div>
        </div>
      </div>
    </article>
  );
}
