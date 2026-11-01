import Link from "next/link";
import { Check, CircleCheck, Minus } from "lucide-react";
import { requireStaff, type Ctx } from "@/lib/ctx";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { formatPhone } from "@/lib/phone";
import { MIN_PASSWORD, newTempPassword } from "@/lib/auth/security";
import { todayISO } from "@/lib/dates";
import { currentStep, doneCount, isSetupStep, readOnboarding, SETUP_STEPS, type Onboarding, type SetupStep } from "@/lib/onboarding";
import { Card, cx, LinkButton, PageHeader } from "@/components/ui";
import { Field, FormGrid, Input, Select } from "@/components/fields";
import { ActionForm, SubmitButton } from "@/components/client";
import { PricingFields } from "../courses/pricing-fields";
import { SalaryRuleFields } from "../salary/rule-fields";
import { salaryRuleLabels } from "../salary/rule-labels";
import { dismissSetupAction, setupBranchAction, setupCourseAction, setupGroupAction, setupTeacherAction, skipStepAction } from "./actions";
import { RoomsEditor, ScheduleFields } from "./wizard-fields";
import { appUrl as envAppUrl } from "@/lib/env";
import { listTeachers } from "@/lib/queries/staff";

export const dynamic = "force-dynamic";

const appUrl = envAppUrl;

function Stepper({ ctx, o, active }: { ctx: Ctx; o: Onboarding; active: SetupStep | null }) {
  const { t } = ctx;
  return (
    <ol className="space-y-1" aria-label={t("setup.title")}>
      {SETUP_STEPS.map((s, i) => {
        const state = o.steps[s];
        const isActive = s === active;
        return (
          <li key={s}>
            <Link
              href={`/setup?step=${s}`}
              aria-current={isActive ? "step" : undefined}
              aria-label={`${i + 1}. ${t(`setup.step.${s}`)}${state ? ` — ${t(state === "done" ? "setup.stepDone" : "setup.stepSkipped")}` : ""}`}
              className={cx("flex items-center gap-3 rounded-lg px-2.5 py-2 transition-colors", isActive ? "bg-zinc-100" : "hover:bg-zinc-50")}
            >
              <span
                className={cx(
                  "tnum flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-medium",
                  state === "done" ? "bg-zinc-900 text-white" : state === "skipped" ? "bg-zinc-100 text-zinc-600" : isActive ? "border border-zinc-900 text-zinc-900" : "border border-zinc-200 text-zinc-500",
                )}
                aria-hidden
              >
                {state === "done" ? <Check className="h-3.5 w-3.5" strokeWidth={2.5} /> : state === "skipped" ? <Minus className="h-3.5 w-3.5" /> : i + 1}
              </span>
              <span className="min-w-0">
                <span className={cx("block truncate text-sm", isActive ? "font-medium text-zinc-950" : "text-zinc-700")}>{t(`setup.step.${s}`)}</span>
                {state && <span className="block text-xs text-zinc-500">{t(state === "done" ? "setup.stepDone" : "setup.stepSkipped")}</span>}
              </span>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}

/** Phones: one row of numbered steps instead of the full list. */
function MiniStepper({ ctx, o, active }: { ctx: Ctx; o: Onboarding; active: SetupStep | null }) {
  const { t } = ctx;
  return (
    <nav className="flex items-center gap-2 lg:hidden" aria-label={t("setup.title")}>
      {SETUP_STEPS.map((s, i) => {
        const state = o.steps[s];
        const isActive = s === active;
        return (
          <Link
            key={s}
            href={`/setup?step=${s}`}
            aria-current={isActive ? "step" : undefined}
            aria-label={`${i + 1}. ${t(`setup.step.${s}`)}${state ? ` — ${t(state === "done" ? "setup.stepDone" : "setup.stepSkipped")}` : ""}`}
            className={cx(
              "tnum flex h-11 min-w-[44px] flex-1 items-center justify-center rounded-lg border text-sm font-medium transition-colors",
              isActive ? "border-zinc-900 text-zinc-950" : state === "done" ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-200 bg-white text-zinc-500",
            )}
          >
            {state === "done" ? <Check className="h-4 w-4" strokeWidth={2.5} aria-hidden /> : state === "skipped" ? <Minus className="h-4 w-4" aria-hidden /> : i + 1}
          </Link>
        );
      })}
    </nav>
  );
}

function StepFooter({ ctx, step, submit = true }: { ctx: Ctx; step: SetupStep; submit?: boolean }) {
  return (
    <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-zinc-100 pt-4">
      {submit && <SubmitButton>{ctx.t("setup.next")}</SubmitButton>}
      <button type="submit" form={`skip-${step}`} className="inline-flex h-9 items-center rounded-lg px-3.5 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900">
        {ctx.t("setup.skip")}
      </button>
    </div>
  );
}

function SkipForm({ step }: { step: SetupStep }) {
  return (
    <form id={`skip-${step}`} action={skipStepAction} className="hidden">
      <input type="hidden" name="step" value={step} />
    </form>
  );
}

async function BranchStep({ ctx }: { ctx: Ctx }) {
  const { t } = ctx;
  const branch = await db.branch.findFirst({
    where: { centerId: ctx.centerId, archivedAt: null },
    orderBy: { createdAt: "asc" },
    include: { rooms: { where: { archivedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true } } },
  });
  if (!branch) return null;
  return (
    <Card title={t("setup.step.branch")}>
      <p className="mb-4 text-sm text-zinc-500">{t("setup.branchIntro")}</p>
      <ActionForm action={setupBranchAction}>
        <input type="hidden" name="branchId" value={branch.id} />
        <FormGrid>
          <Field label={t("setup.branchName")}><Input name="name" defaultValue={branch.name} required maxLength={120} /></Field>
          <Field label={t("setup.address")}><Input name="address" defaultValue={branch.address ?? ""} maxLength={200} /></Field>
        </FormGrid>
        <div className="mt-4">
          <span className="mb-1.5 block text-[13px] font-medium text-zinc-700">{t("setup.rooms")}</span>
          <RoomsEditor initial={branch.rooms} labels={{ placeholder: t("setup.roomPh"), add: t("setup.addRoom"), remove: t("setup.removeRoom") }} />
          <span className="mt-1.5 block text-xs text-zinc-500">{t("setup.roomsHint")}</span>
        </div>
        <StepFooter ctx={ctx} step="branch" />
      </ActionForm>
      <SkipForm step="branch" />
    </Card>
  );
}

async function CourseStep({ ctx, o }: { ctx: Ctx; o: Onboarding }) {
  const { t } = ctx;
  const existing = o.courseId ? await db.course.findFirst({ where: { id: o.courseId, centerId: ctx.centerId } }) : null;
  if (existing) {
    return (
      <Card title={t("setup.step.course")}>
        <p className="text-sm text-zinc-700">
          <Link href="/courses" className="font-medium text-zinc-900 underline decoration-zinc-300 underline-offset-2 hover:decoration-zinc-900">{existing.name}</Link>
          {" · "}
          <span className="tnum">{formatMoney(existing.price)}</span> · {t(`pricing.${existing.pricingType}`)}
        </p>
        <div className="mt-5 border-t border-zinc-100 pt-4"><LinkButton href="/setup?step=group">{t("setup.next")}</LinkButton></div>
      </Card>
    );
  }
  const l = {
    pricingType: t("courses.pricingType"),
    SUBSCRIPTION: t("pricing.SUBSCRIPTION"),
    PACKAGE: t("pricing.PACKAGE"),
    renewal: t("courses.renewal"),
    CALENDAR: t("renewal.CALENDAR"),
    GROUP_START: t("renewal.GROUP_START"),
    STUDENT_START: t("renewal.STUDENT_START"),
    pricePerMonth: t("courses.pricePerMonth"),
    pricePackage: t("courses.pricePackage"),
    packageLessons: t("courses.packageLessons"),
    packageLessonsHint: t("courses.packageLessonsHint"),
    installments: t("courses.installments"),
    priceFrom: t("courses.priceFrom"),
    priceFromHint: t("courses.priceFromHint"),
  };
  return (
    <Card title={t("setup.step.course")}>
      <p className="mb-4 text-sm text-zinc-500">{t("setup.courseIntro")}</p>
      <ActionForm action={setupCourseAction} className="space-y-4">
        <Field label={t("common.name")}><Input name="name" required maxLength={120} placeholder={t("setup.courseNamePh")} /></Field>
        <FormGrid>
          <Field label={t("courses.lessonMinutes")}><Input name="lessonMinutes" type="number" min={15} max={600} defaultValue={90} /></Field>
          <Field label={t("courses.lessonsPerWeek")}><Input name="lessonsPerWeek" type="number" min={1} max={21} defaultValue={3} /></Field>
        </FormGrid>
        <PricingFields l={l} />
        <StepFooter ctx={ctx} step="course" />
      </ActionForm>
      <SkipForm step="course" />
    </Card>
  );
}

async function GroupStep({ ctx, o }: { ctx: Ctx; o: Onboarding }) {
  const { t } = ctx;
  const existing = o.groupId ? await db.group.findFirst({ where: { id: o.groupId, centerId: ctx.centerId }, include: { _count: { select: { lessons: true } } } }) : null;
  if (existing) {
    return (
      <Card title={t("setup.step.group")}>
        <p className="text-sm text-zinc-700">
          <Link href={`/groups/${existing.id}`} className="font-medium text-zinc-900 underline decoration-zinc-300 underline-offset-2 hover:decoration-zinc-900">
            {existing.name} (#{existing.code})
          </Link>
        </p>
        <div className="mt-5 border-t border-zinc-100 pt-4"><LinkButton href="/setup?step=teacher">{t("setup.next")}</LinkButton></div>
      </Card>
    );
  }
  const [courses, branches, teachers] = await Promise.all([
    db.course.findMany({ where: { centerId: ctx.centerId, archivedAt: null }, orderBy: { createdAt: "asc" }, select: { id: true, name: true, lessonMinutes: true } }),
    db.branch.findMany({ where: { centerId: ctx.centerId, archivedAt: null }, orderBy: { createdAt: "asc" }, include: { rooms: { where: { archivedAt: null }, orderBy: { name: "asc" } } } }),
    listTeachers(ctx.centerId, { exceptId: ctx.userId }),
  ]);
  if (courses.length === 0) {
    return (
      <Card title={t("setup.step.group")}>
        <p className="text-sm text-zinc-500">{t("setup.needCourse")}</p>
        <div className="mt-5 flex flex-wrap gap-2 border-t border-zinc-100 pt-4">
          <LinkButton href="/setup?step=course">{t("setup.step.course")}</LinkButton>
          <button type="submit" form="skip-group" className="inline-flex h-9 items-center rounded-lg px-3.5 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900">{t("setup.skip")}</button>
        </div>
        <SkipForm step="group" />
      </Card>
    );
  }
  const course = courses.find((c) => c.id === o.courseId) ?? courses[0];
  const branch = branches[0];
  return (
    <Card title={t("setup.step.group")}>
      <p className="mb-4 text-sm text-zinc-500">{t("setup.groupIntro")}</p>
      <ActionForm action={setupGroupAction} className="space-y-4">
        <FormGrid>
          <Field label={t("common.name")}><Input name="name" required maxLength={120} defaultValue={course.name} placeholder={t("setup.groupNamePh")} /></Field>
          <Field label={t("common.course")}>
            <Select name="courseId" defaultValue={course.id}>
              {courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          {branches.length > 1 ? (
            <Field label={t("common.branch")}>
              <Select name="branchId" defaultValue={branch.id}>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </Select>
            </Field>
          ) : (
            <input type="hidden" name="branchId" value={branch.id} />
          )}
          <Field label={t("common.room")}>
            <Select name="roomId" defaultValue={branch.rooms[0]?.id ?? ""}>
              <option value="">—</option>
              {branches.flatMap((b) => b.rooms.map((r) => <option key={r.id} value={r.id}>{branches.length > 1 ? `${b.name} · ${r.name}` : r.name}</option>))}
            </Select>
          </Field>
          <Field label={t("common.teacher")}>
            <Select name="teacherId" defaultValue={ctx.userId}>
              <option value={ctx.userId}>{t("setup.me", { name: ctx.userName })}</option>
              {teachers.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </Select>
          </Field>
          <Field label={t("setup.startDate")}><Input type="date" name="startDate" required defaultValue={todayISO()} /></Field>
        </FormGrid>
        <ScheduleFields
          minutes={course.lessonMinutes}
          days={[1, 2, 3, 4, 5, 6, 7].map((d) => t(`common.weekday.${d}` as "common.weekday.1"))}
          labels={{ days: t("setup.days"), start: t("setup.startTime"), end: t("setup.endTime") }}
        />
        <StepFooter ctx={ctx} step="group" />
      </ActionForm>
      <SkipForm step="group" />
    </Card>
  );
}

async function TeacherStep({ ctx, o }: { ctx: Ctx; o: Onboarding }) {
  const { t } = ctx;
  const existing = o.teacherId ? await db.user.findFirst({ where: { id: o.teacherId, centerId: ctx.centerId }, select: { name: true, phone: true } }) : null;
  if (existing) {
    return (
      <Card title={t("setup.step.teacher")}>
        <p className="text-sm text-zinc-700">{existing.name}</p>
        <p className="mt-1 text-sm text-zinc-500">{t("setup.teacherLogin", { url: `${appUrl()}/login`, phone: formatPhone(existing.phone) })}</p>
        <div className="mt-5 border-t border-zinc-100 pt-4"><LinkButton href="/setup">{t("setup.next")}</LinkButton></div>
      </Card>
    );
  }
  const group = o.groupId ? await db.group.findFirst({ where: { id: o.groupId, centerId: ctx.centerId }, select: { id: true, name: true, teacherId: true } }) : null;
  return (
    <Card title={t("setup.step.teacher")}>
      <p className="mb-4 text-sm text-zinc-500">{t("setup.teacherIntro")}</p>
      <ActionForm action={setupTeacherAction} className="space-y-4">
        <FormGrid>
          <Field label={t("setup.teacherName")}><Input name="name" required maxLength={120} autoComplete="off" /></Field>
          <Field label={t("common.phone")}><Input name="phone" type="tel" inputMode="tel" required placeholder="90 123 45 67" autoComplete="off" /></Field>
          <Field label={t("setup.tempPassword")} hint={t("setup.tempPasswordHint")}><Input name="password" required minLength={MIN_PASSWORD} defaultValue={newTempPassword()} autoComplete="off" spellCheck={false} /></Field>
        </FormGrid>
        {ctx.can("finance.view") && (
          // the divider sits on a wrapper: a <legend> on a bordered fieldset is drawn across the line
          <div className="border-t border-zinc-100 pt-4">
            <fieldset className="space-y-3">
              <legend className="mb-1 text-sm font-medium text-zinc-900">{t("setup.teacherSalary")}</legend>
              <p className="text-xs text-zinc-500">{t("setup.teacherSalaryHint")}</p>
              <SalaryRuleFields labels={salaryRuleLabels(t)} />
            </fieldset>
          </div>
        )}
        {group && group.teacherId === ctx.userId && (
          <label className="flex cursor-pointer items-start gap-2.5 text-sm text-zinc-700">
            <input type="checkbox" name="assignGroupId" value={group.id} defaultChecked className="mt-0.5 h-4 w-4 shrink-0 rounded-sm border-zinc-300 accent-[rgb(var(--accent))]" />
            <span>{t("setup.assignGroup", { group: group.name })}</span>
          </label>
        )}
        <StepFooter ctx={ctx} step="teacher" />
      </ActionForm>
      <SkipForm step="teacher" />
    </Card>
  );
}

async function DoneStep({ ctx, o }: { ctx: Ctx; o: Onboarding }) {
  const { t } = ctx;
  const teacher = o.teacherId ? await db.user.findFirst({ where: { id: o.teacherId, centerId: ctx.centerId }, select: { phone: true } }) : null;
  return (
    <Card>
      <div className="flex flex-col items-start gap-3 py-2">
        <CircleCheck className="h-6 w-6 text-emerald-700" strokeWidth={1.75} aria-hidden />
        <div>
          <h2 className="text-base font-semibold text-zinc-950">{t("setup.doneTitle")}</h2>
          <p className="mt-1 text-sm text-zinc-500">{t("setup.doneText")}</p>
          {teacher && <p className="mt-2 text-sm text-zinc-500">{t("setup.teacherLogin", { url: `${appUrl()}/login`, phone: formatPhone(teacher.phone) })}</p>}
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <LinkButton href="/students/new">{t("setup.addStudent")}</LinkButton>
          <LinkButton href="/" variant="secondary">{t("setup.toDashboard")}</LinkButton>
        </div>
      </div>
    </Card>
  );
}

export default async function SetupPage({ searchParams }: { searchParams: Promise<{ step?: string }> }) {
  const ctx = await requireStaff("settings");
  const { t } = ctx;
  const { step } = await searchParams;
  const c = await db.center.findUniqueOrThrow({ where: { id: ctx.centerId }, select: { onboarding: true } });
  const o = readOnboarding(c.onboarding);
  const active: SetupStep | null = isSetupStep(step) ? step : currentStep(o);
  return (
    <>
      <PageHeader
        title={t("setup.title")}
        subtitle={`${t("setup.subtitle")} ${t("setup.progress", { done: doneCount(o), total: SETUP_STEPS.length })}`}
        actions={
          !o.completedAt && (
            <form action={dismissSetupAction}>
              <button type="submit" className="inline-flex h-9 items-center rounded-lg px-3.5 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900">{t("setup.later")}</button>
            </form>
          )
        }
      />
      <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
        <Card pad={false} className="hidden h-fit p-2 lg:block">
          <Stepper ctx={ctx} o={o} active={active} />
        </Card>
        <MiniStepper ctx={ctx} o={o} active={active} />
        <div className="min-w-0">
          {active === "branch" && <BranchStep ctx={ctx} />}
          {active === "course" && <CourseStep ctx={ctx} o={o} />}
          {active === "group" && <GroupStep ctx={ctx} o={o} />}
          {active === "teacher" && <TeacherStep ctx={ctx} o={o} />}
          {active === null && <DoneStep ctx={ctx} o={o} />}
        </div>
      </div>
    </>
  );
}
