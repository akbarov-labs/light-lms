import Link from "next/link";
import { Check, Pencil, Plus } from "lucide-react";
import { notFound } from "next/navigation";
import { familyScope, requireStaff } from "@/lib/ctx";
import { db } from "@/lib/db";
import { formatDate, todayISO } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { formatPhone } from "@/lib/phone";
import { enrollmentTone, fullName } from "@/lib/format";
import { familyAllocation, familyLedger } from "@/lib/services/wallet";
import { payLinkForFamily } from "@/lib/payments/links";
import { Badge, Card, PageHeader, Stat, Table, Td, Th, Tr, cx } from "@/components/ui";
import { Checkbox, Field, FormGrid, Input, Select } from "@/components/fields";
import { ActionMenu, Modal, ModalForm, MoneyInput, SubmitButton } from "@/components/client";
import { LedgerTable } from "@/components/ledger-table";
import { PaymentForm } from "@/components/payment-form";
import { refundAction } from "../../payments/actions";
import { renameFamilyAction, saveGuardianAction } from "../../students/actions";

export default async function FamilyPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ pay?: string; student?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await requireStaff();
  const { t } = ctx;
  const family = await db.family.findFirst({
    where: { id, centerId: ctx.centerId, ...(ctx.branchIds ? familyScope({ ...ctx, activeBranchId: null }) : {}) },
    include: {
      guardians: { orderBy: { isPrimary: "desc" } },
      students: { include: { enrollments: { where: { endDate: null }, include: { group: { select: { id: true, name: true, code: true } } } } } },
    },
  });
  if (!family) notFound();
  const showMoney = ctx.can("finance.view") || ctx.can("payments.take");
  const [alloc, ledger] = await Promise.all([familyAllocation(id), showMoney ? familyLedger(id) : Promise.resolve([])]);
  const payUrl = await payLinkForFamily(id);
  const enrollmentOptions = family.students.flatMap((s) =>
    s.enrollments.map((e) => ({ id: e.id, studentId: s.id, who: fullName(s), label: `${fullName(s)} · ${e.group.name} #${e.group.code}`, debt: alloc.enrollments.get(e.id)?.debt ?? 0 })),
  );

  const GuardianFields = ({ g }: { g?: (typeof family.guardians)[number] }) => (
    <ModalForm action={saveGuardianAction} className="space-y-3">
      <input type="hidden" name="familyId" value={id} />
      {g && <input type="hidden" name="id" value={g.id} />}
      <FormGrid>
        <Field label={t("common.fullName")}><Input name="name" defaultValue={g?.name} required /></Field>
        <Field label={t("common.phone")}><Input name="phone" defaultValue={g ? formatPhone(g.phone) : ""} required /></Field>
        <Field label={t("students.relation")}>
          <Select name="relation" defaultValue={g?.relation ?? "mother"}>
            <option value="mother">{t("students.relation.mother")}</option>
            <option value="father">{t("students.relation.father")}</option>
            <option value="other">{t("students.relation.other")}</option>
            <option value="self">—</option>
          </Select>
        </Field>
        <div className="pt-6"><Checkbox name="isPrimary" label={t("students.primary")} defaultChecked={g?.isPrimary ?? false} /></div>
      </FormGrid>
      <SubmitButton>{t("common.save")}</SubmitButton>
    </ModalForm>
  );

  return (
    <>
      <PageHeader
        back={sp.student ? { href: `/students/${sp.student}`, label: t("common.student") } : { href: "/students", label: t("nav.students") }}
        title={family.name}
        subtitle={t("family.wallet")}
        actions={
          <>
            {ctx.can("students.edit") && (
              <Modal label={t("common.edit")} title={t("family.name")} variant="secondary">
                <ModalForm action={renameFamilyAction} className="space-y-3">
                  <input type="hidden" name="familyId" value={id} />
                  <Field label={t("family.name")}><Input name="name" defaultValue={family.name} required /></Field>
                  <SubmitButton>{t("common.save")}</SubmitButton>
                </ModalForm>
              </Modal>
            )}
            {ctx.can("payments.refund") && (
              <ActionMenu
                label={t("shell.more")}
                items={[{ key: "refund", label: t("pay.refund"), danger: true, wide: true, content: (
                  <ModalForm action={refundAction} className="space-y-3">
                  <input type="hidden" name="familyId" value={id} />
                  <FormGrid>
                    <Field label={t("common.amount")}><MoneyInput name="amount" required /></Field>
                    <Field label={t("common.method")}>
                      <Select name="method">{(["CASH", "CARD", "TRANSFER", "PAYNET"] as const).map((m) => <option key={m} value={m}>{t(`method.${m}`)}</option>)}</Select>
                    </Field>
                    <Field label={t("common.date")}><Input type="date" name="date" defaultValue={todayISO()} required /></Field>
                    <Field label={t("common.reason")}><Input name="reason" required /></Field>
                  </FormGrid>
                  <Checkbox name="force" label={t("money.refundForce")} />
                  <p className="text-xs text-zinc-500">{t("pay.refundHint")}</p>
                  <SubmitButton variant="danger">{t("pay.refund")}</SubmitButton>
                </ModalForm>
                ) }]}
              />
            )}
          </>
        }
      />
      {showMoney && (
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat label={t("common.balance")} value={formatMoney(alloc.balance)} />
          <Stat label={t("common.debt")} value={formatMoney(alloc.totalDebt)} tone={alloc.totalDebt > 0 ? "red" : undefined} hint={alloc.oldestUnpaidDate ? `${formatDate(alloc.oldestUnpaidDate)} ${t("common.from").toLowerCase()}` : undefined} />
          <Stat label={t("students.prepaid")} value={formatMoney(alloc.unallocated)} />
        </div>
      )}
      <div className="mb-4 grid gap-4 lg:grid-cols-3">
        {ctx.can("payments.take") && (
          <Card className="lg:col-span-2" title={t("pay.title")}>
            <PaymentForm ctx={ctx} familyId={id} familyName={family.name} options={enrollmentOptions} familyDebt={alloc.totalDebt} studentId={sp.student && family.students.some((x) => x.id === sp.student) ? sp.student : undefined} />
            {payUrl && alloc.totalDebt > 0 && (
              <p className="mt-3 text-xs text-zinc-500">{t("pay.link")}: <a href={payUrl} className="break-all text-zinc-900 underline decoration-zinc-300 hover:decoration-zinc-900" target="_blank" rel="noreferrer">{payUrl}</a></p>
            )}
          </Card>
        )}
        <Card
          title={t("students.guardians")}
          actions={ctx.can("students.edit") && <Modal label="" icon={<Plus className="h-3.5 w-3.5" aria-hidden />} ariaLabel={t("students.addGuardian")} title={t("students.addGuardian")} variant="secondary" size="sm"><GuardianFields /></Modal>}
        >
          <div className="space-y-3 text-sm">
            {family.guardians.map((g) => (
              <div key={g.id} className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-medium">{g.name} {g.isPrimary && <span className="text-xs text-zinc-500">· {t("students.primary")}</span>}</div>
                  <a href={`tel:+${g.phone}`} className="text-xs text-zinc-900 underline decoration-zinc-300 hover:decoration-zinc-900">{formatPhone(g.phone)}</a>
                  {g.telegramChatId && <Badge tone="blue">TG</Badge>}
                </div>
                {ctx.can("students.edit") && <Modal label="" icon={<Pencil className="h-3.5 w-3.5" aria-hidden />} ariaLabel={`${t("common.edit")}: ${g.name}`} title={g.name} variant="ghost" size="sm"><GuardianFields g={g} /></Modal>}
              </div>
            ))}
            <div className="border-t border-zinc-100 pt-2">
              <div className="mb-1 text-xs text-zinc-500">{t("family.students")}</div>
              {family.students.map((s) => (
                <div key={s.id} className="mb-1">
                  <Link href={`/students/${s.id}`} className="font-medium text-zinc-900 underline decoration-zinc-300 hover:decoration-zinc-900">{fullName(s)}</Link>
                  <div className="flex flex-wrap gap-1">{s.enrollments.map((e) => <Badge key={e.id} tone={enrollmentTone[e.status]}>{e.group.name}</Badge>)}</div>
                </div>
              ))}
            </div>
          </div>
        </Card>
      </div>
      {showMoney && alloc.units.length > 0 && (
        <Card className="mb-4" pad={false} title={t("students.units")}>
          <ul className="divide-y divide-zinc-100 sm:hidden">
            {[...alloc.units].reverse().map((u) => (
              <li key={u.key} className="flex items-start justify-between gap-3 px-4 py-3 text-sm">
                <span className="min-w-0 text-zinc-700">{u.description}</span>
                <span className="tnum shrink-0 text-right">
                  {u.due > 0 ? <span className="font-medium text-red-600">{formatMoney(u.due)}</span> : <Check className="ml-auto h-4 w-4 text-emerald-700" aria-label={t("students.unitPaid")} />}
                  <span className="block text-xs text-zinc-500">{t("students.chargedShort", { amount: formatMoney(u.charged) })}</span>
                </span>
              </li>
            ))}
          </ul>
          <Table className="hidden sm:block">
            <thead><tr><Th>{t("enr.period")}</Th><Th className="text-right">{t("common.charged")}</Th><Th className="text-right">{t("common.paid")}</Th><Th className="text-right">{t("common.debt")}</Th></tr></thead>
            <tbody>
              {[...alloc.units].reverse().map((u) => (
                <Tr key={u.key}>
                  <Td className="text-sm">{u.description}</Td>
                  <Td className="tnum whitespace-nowrap text-right">{formatMoney(u.charged)}</Td>
                  <Td className="tnum whitespace-nowrap text-right text-emerald-700">{formatMoney(u.paid)}</Td>
                  <Td className={cx("tnum whitespace-nowrap text-right font-medium", u.due > 0 ? "text-red-600" : "text-zinc-400")}>{u.due > 0 ? formatMoney(u.due) : <Check className="ml-auto h-4 w-4 text-emerald-700" aria-label={t("students.unitPaid")} />}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
      {showMoney && (
        <Card pad={false} title={t("students.ledger")}>
          <LedgerTable ctx={ctx} rows={ledger} showStudent />
        </Card>
      )}
    </>
  );
}
