import Link from "next/link";
import { requireStaff, studentScope } from "@/lib/ctx";
import { db } from "@/lib/db";
import { formatDate, formatDateTime, toISODate } from "@/lib/dates";
import { fullName } from "@/lib/format";
import { Badge, Card, EmptyState, LinkButton, PageHeader, Table, Td, Th, Tr } from "@/components/ui";
import { Field, Input } from "@/components/fields";
import { Modal, ModalForm, SubmitButton } from "@/components/client";
import { revokeCertificateAction } from "../exams/actions";

export default async function CertificatesPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireStaff();
  const { t } = ctx;
  const q = sp.q?.trim().slice(0, 60) ?? "";
  const certs = await db.certificate.findMany({
    where: {
      centerId: ctx.centerId,
      ...(ctx.branchIds ? { student: studentScope({ ...ctx, activeBranchId: null }) } : {}),
      ...(q
        ? {
            OR: [
              { number: { contains: q, mode: "insensitive" } },
              { code: { contains: q.toUpperCase() } },
              { title: { contains: q, mode: "insensitive" } },
              { student: { OR: [{ firstName: { contains: q, mode: "insensitive" } }, { lastName: { contains: q, mode: "insensitive" } }] } },
            ],
          }
        : {}),
    },
    include: { student: { select: { id: true, firstName: true, lastName: true } } },
    orderBy: [{ issuedAt: "desc" }, { createdAt: "desc" }],
    take: 200,
  });
  return (
    <>
      <PageHeader title={t("nav.certificates")} actions={ctx.can("export") && <LinkButton variant="secondary" href="/api/export/certificates">{t("common.export")}</LinkButton>} />
      <form className="mb-4 flex gap-2">
        <Input name="q" defaultValue={q} placeholder={`${t("cert.number")}, ${t("cert.code")}, ${t("common.student").toLowerCase()}…`} aria-label={t("common.search")} className="max-w-sm" />
        <button className="h-9 rounded-lg bg-zinc-900 px-3.5 text-sm font-medium text-white hover:bg-zinc-800">{t("common.search")}</button>
      </form>
      <Card pad={false}>
        {certs.length === 0 ? (
          <EmptyState>{t("cert.none")}</EmptyState>
        ) : (
          <Table>
            <thead><tr><Th>{t("cert.number")}</Th><Th>{t("cert.issuedAt")}</Th><Th>{t("common.student")}</Th><Th>{t("cert.courseTitle")}</Th><Th>{t("cert.code")}</Th><Th /></tr></thead>
            <tbody>
              {certs.map((c) => (
                <Tr key={c.id} muted={!!c.revokedAt}>
                  <Td className="tnum whitespace-nowrap"><Link href={`/certificates/${c.id}`} className="font-medium hover:underline">{c.number}</Link></Td>
                  <Td className="whitespace-nowrap text-xs">{formatDate(toISODate(c.issuedAt))}</Td>
                  <Td><Link href={`/students/${c.student.id}`} className="hover:underline">{fullName(c.student)}</Link></Td>
                  <Td className="text-xs">{c.title}{c.level ? ` · ${c.level}` : ""}</Td>
                  <Td className="font-mono text-xs">{c.code}</Td>
                  <Td className="whitespace-nowrap text-right">
                    {c.revokedAt ? (
                      <Badge tone="red">{t("cert.revokedOn", { date: formatDateTime(c.revokedAt).slice(0, 10) })}</Badge>
                    ) : (
                      ctx.can("groups.edit") && (
                        <Modal label={t("cert.revoke")} title={`${t("cert.revoke")}: ${c.number}`} variant="ghost" size="sm">
                          <ModalForm action={revokeCertificateAction} className="space-y-3">
                            <input type="hidden" name="id" value={c.id} />
                            <p className="text-sm text-zinc-600">{t("cert.revokeHint")}</p>
                            <Field label={t("common.reason")}><Input name="reason" required maxLength={300} /></Field>
                            <SubmitButton variant="danger">{t("cert.revoke")}</SubmitButton>
                          </ModalForm>
                        </Modal>
                      )
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
