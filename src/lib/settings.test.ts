import { describe, expect, it } from "vitest";
import { readSettings } from "./settings";

const notifyAll = { payment: true, reminder: true, debt: true, debtDaily: false, absence: true, trial: true, teacherReminder: true, dailyReport: true, reportCard: true, examResult: true };
const defaults = {
  trialLessons: 1,
  excusedAbsenceCredit: false,
  payTeacherForTrial: false,
  payFromCollected: false,
  gradeScale: "5",
  reminderDaysBefore: 3,
  lessonsAheadDays: 60,
  transferAsTrial: false,
  expenseCategories: ["Ijara / Rent", "Kommunal / Utilities", "Reklama / Ads", "Oylik / Salary", "Jihozlar / Equipment", "Ofis / Office", "Boshqa / Other"],
  notify: notifyAll,
  paymeFiscal: null,
  reportCards: { autoSend: false, sendDay: 3 },
  sms: { payment: false, reminder: true, debt: true, absence: false, trial: true, reportCard: false, examResult: false, onlyWithoutTelegram: true },
  agent: { enabled: false, rules: "", monthlyTokenCap: 5_000_000 },
  homework: { enabled: false, directFromGrade: 9, dueMinutesBefore: 0, lateDays: 0, attempts: 3, remindHoursBefore: 3, photos: false },
  parentReports: { weekly: false, weekday: 7, hour: 18 },
  makeupWeekdays: [1, 2, 3, 4, 5, 6, 7],
  dailyReportHour: 21,
};

describe("readSettings (Center.settings JSON)", () => {
  it("keeps the AI agent off by default, and a broken agent block does not reset other settings", () => {
    expect(readSettings({}).agent.enabled).toBe(false);
    expect(readSettings({ agent: { enabled: true, rules: "Chegirma yo'q" } }).agent).toEqual({ enabled: true, rules: "Chegirma yo'q", monthlyTokenCap: 5_000_000 });
    const s = readSettings({ trialLessons: 2, agent: { enabled: "yes", monthlyTokenCap: -1 } });
    expect(s).toEqual({ ...defaults, trialLessons: 2 });
  });

  it("fills every default, including the nested notify object, from nothing", () => {
    expect(readSettings(undefined)).toEqual(defaults);
    expect(readSettings(null)).toEqual(defaults);
    expect(readSettings({})).toEqual(defaults);
  });

  it("keeps homework off by default; a broken homework block does not reset other settings", () => {
    const hw = { enabled: true, directFromGrade: 9, dueMinutesBefore: 0, lateDays: 0, attempts: 3, remindHoursBefore: 3, photos: false };
    expect(readSettings({ homework: { enabled: true } }).homework).toEqual(hw);
    expect(readSettings({ homework: { enabled: true, directFromGrade: 6 } }).homework).toEqual({ ...hw, directFromGrade: 6 });
    // the first pilot center
    expect(readSettings({ homework: { enabled: true, dueMinutesBefore: 60, lateDays: 2, photos: true } }).homework).toEqual({ ...hw, dueMinutesBefore: 60, lateDays: 2, photos: true });
    expect(readSettings({ dailyReportHour: 19 }).dailyReportHour).toBe(19);
    expect(readSettings({ dailyReportHour: 3 }).dailyReportHour).toBe(21);
    expect(readSettings({ trialLessons: 2, homework: { directFromGrade: 40 } })).toEqual({ ...defaults, trialLessons: 2 });
  });

  it("fills nested notify defaults when notify is partial or empty", () => {
    expect(readSettings({ notify: {} }).notify).toEqual(notifyAll);
    expect(readSettings({ notify: { debt: false } }).notify).toEqual({ ...notifyAll, debt: false });
  });

  it("keeps stored values and drops unknown keys", () => {
    const s = readSettings({ trialLessons: 0, gradeScale: "100", payFromCollected: true, legacy: 1 });
    expect(s).toEqual({ ...defaults, trialLessons: 0, gradeScale: "100", payFromCollected: true });
  });

  it("an invalid value resets everything to defaults", () => {
    expect(readSettings({ trialLessons: 99, payFromCollected: true })).toEqual(defaults);
    expect(readSettings({ notify: { payment: "yes" } })).toEqual(defaults);
    expect(readSettings("junk")).toEqual(defaults);
  });

  it("a broken paymeFiscal becomes null without touching other settings", () => {
    const s = readSettings({ trialLessons: 2, paymeFiscal: { ikpu: "123" } });
    expect(s).toEqual({ ...defaults, trialLessons: 2, paymeFiscal: null });
    const fiscal = { ikpu: "10305001001000000", packageCode: "1515645", vatPercent: 12 };
    expect(readSettings({ paymeFiscal: fiscal }).paymeFiscal).toEqual(fiscal);
  });
});
