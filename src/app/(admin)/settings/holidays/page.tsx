import { requireStaff } from "@/lib/ctx";
import { db } from "@/lib/db";
import { formatDate, toISODate } from "@/lib/dates";
import { Card, EmptyState, Table, Td, Th, Tr } from "@/components/ui";
import { Field, FormGrid, Input } from "@/components/fields";
import { ActionForm, SubmitButton } from "@/components/client";
import { addHolidayAction, removeHolidayAction } from "../actions";

export default async function HolidaysPage() {
  const ctx = await requireStaff("settings");
  const { t } = ctx;
  const holidays = await db.holiday.findMany({ where: { centerId: ctx.centerId }, orderBy: { date: "desc" } });
  return (
    <div className="space-y-4">
      <Card title={t("settings.newHoliday")}>
        <p className="mb-3 text-sm text-zinc-500">{t("settings.holidayHint")}</p>
        <ActionForm action={addHolidayAction} reset>
          <FormGrid cols={3}>
            <Field label={t("common.date")}><Input type="date" name="date" required /></Field>
            <Field label={t("common.name")}><Input name="name" required /></Field>
            <div className="pt-5"><SubmitButton>{t("common.add")}</SubmitButton></div>
          </FormGrid>
        </ActionForm>
      </Card>
      <Card pad={false}>
        {holidays.length === 0 ? (
          <EmptyState>{t("common.empty")}</EmptyState>
        ) : (
          <Table>
            <thead><tr><Th>{t("common.date")}</Th><Th>{t("common.name")}</Th><Th /></tr></thead>
            <tbody>
              {holidays.map((h) => (
                <Tr key={h.id}>
                  <Td>{formatDate(toISODate(h.date))}</Td>
                  <Td>{h.name}</Td>
                  <Td className="text-right">
                    <ActionForm action={removeHolidayAction}>
                      <input type="hidden" name="id" value={h.id} />
                      <SubmitButton variant="ghost" size="sm" confirm={t("common.confirm")}>{t("common.delete")}</SubmitButton>
                    </ActionForm>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
