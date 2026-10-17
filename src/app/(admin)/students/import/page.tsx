import { requireStaff } from "@/lib/ctx";
import { Card, PageHeader } from "@/components/ui";
import { Checkbox, Field, Input } from "@/components/fields";
import { ActionForm, SubmitButton } from "@/components/client";
import { importStudentsAction } from "./actions";

export default async function ImportPage() {
  const ctx = await requireStaff("students.edit");
  const { t } = ctx;
  return (
    <>
      <PageHeader title={t("import.title")} back={{ href: "/students", label: t("nav.students") }} />
      <Card>
        <p className="mb-2 text-sm text-zinc-600">{t("import.hint")}</p>
        <p className="mb-2 text-sm text-zinc-500">{t("import.billingHint")}</p>
        <p className="mb-4 text-sm text-zinc-500">{t("money.import.debtSinceHint")}</p>
        <pre className="mb-4 overflow-x-auto rounded-lg bg-zinc-50 p-3 text-xs">Karimov,Ali,901112233,935551122,1,-300000,15.08.2026{"\n"}Saidova,Madina,,977778899,3,0</pre>
        <ActionForm action={importStudentsAction} className="space-y-3">
          <Field label={t("import.file")}><Input type="file" name="file" accept=".csv,text/csv" required /></Field>
          <Checkbox name="dryRun" label={t("import.dryRun")} defaultChecked />
          <SubmitButton>{t("import.run")}</SubmitButton>
        </ActionForm>
      </Card>
    </>
  );
}
