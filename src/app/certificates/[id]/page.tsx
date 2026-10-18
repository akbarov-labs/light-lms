import { notFound } from "next/navigation";
import Link from "next/link";
import { requireStaff, studentScope } from "@/lib/ctx";
import { db } from "@/lib/db";
import { fullName } from "@/lib/format";
import { verifyUrl } from "@/lib/services/exams";
import { CertificateView } from "@/components/certificate-view";
import { PrintButton } from "@/components/client";
import { DocTitle } from "@/components/doc-title";

export const dynamic = "force-dynamic";

/** Staff: one certificate, ready to print on A4 landscape. */
export default async function CertificatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireStaff();
  const { t } = ctx;
  const c = await db.certificate.findFirst({
    where: { id, centerId: ctx.centerId, ...(ctx.branchIds ? { student: studentScope({ ...ctx, activeBranchId: null }) } : {}) },
    include: { student: true, center: { select: { name: true, logoUrl: true } } },
  });
  if (!c) notFound();
  return (
    <main className="mx-auto max-w-5xl px-4 py-6 print:max-w-none print:p-0">
      <style>{"@page { size: A4 landscape; margin: 10mm; }"}</style>
      <DocTitle title={`${t("cert.title")} ${c.number} · ${c.student.lastName} ${c.student.firstName}`} />
      <div className="mb-4 flex flex-wrap items-center gap-3 print:hidden">
        <Link href="/certificates" className="text-sm text-zinc-500 hover:text-zinc-900">← {t("nav.certificates")}</Link>
        <PrintButton label={t("common.print")} />
      </div>
      <CertificateView
        t={t}
        c={{ center: c.center.name, logoUrl: c.center.logoUrl, student: fullName({ firstName: c.student.firstName, lastName: c.student.lastName }), title: c.title, level: c.level, score: c.score, maxScore: c.maxScore, number: c.number, issuedAt: c.issuedAt, code: c.code, verifyUrl: verifyUrl(c.code), revokedAt: c.revokedAt }}
      />
    </main>
  );
}
