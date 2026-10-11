import { notFound } from "next/navigation";
import { requireStaff, studentScope } from "@/lib/ctx";
import { db } from "@/lib/db";
import { fullName } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { StudentForm } from "../../student-form";

export default async function EditStudentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireStaff("students.edit");
  const student = await db.student.findFirst({ where: { id, centerId: ctx.centerId, ...(ctx.branchIds ? studentScope({ ...ctx, activeBranchId: null }) : {}) } });
  if (!student) notFound();
  return (
    <>
      <PageHeader title={ctx.t("students.edit")} back={{ href: `/students/${id}`, label: fullName(student) }} />
      <StudentForm ctx={ctx} student={student} />
    </>
  );
}
