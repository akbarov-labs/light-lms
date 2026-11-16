import { requireStaff } from "@/lib/ctx";
import { db } from "@/lib/db";
import { formatPhone } from "@/lib/phone";
import { PageHeader } from "@/components/ui";
import { StudentForm } from "../student-form";

export default async function NewStudentPage({ searchParams }: { searchParams: Promise<{ leadId?: string }> }) {
  const { leadId } = await searchParams;
  const ctx = await requireStaff("students.edit");
  const lead = leadId ? await db.lead.findFirst({ where: { id: leadId, centerId: ctx.centerId } }) : null;
  const [first, ...rest] = (lead?.name ?? "").split(/\s+/);
  return (
    <>
      <PageHeader title={ctx.t("students.new")} back={{ href: lead ? `/leads/${lead.id}` : "/students", label: lead ? lead.name : ctx.t("nav.students") }} />
      <StudentForm
        ctx={ctx}
        prefill={lead ? { firstName: rest.length ? rest.join(" ") : first, lastName: rest.length ? first : "", phone: lead.phone ? formatPhone(lead.phone) : "", guardianPhone: lead.phone ? formatPhone(lead.phone) : "", source: lead.source ?? undefined, leadId: lead.id, courseId: lead.courseId } : undefined}
      />
    </>
  );
}
