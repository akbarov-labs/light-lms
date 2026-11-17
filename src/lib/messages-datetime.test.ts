import { afterEach, describe, expect, it } from "vitest";
import { msg, stripTgTime, tashkentUnix, tgTime } from "./messages";
import { richMsg } from "./rich-messages";
import { htmlToSms } from "./sms/text";

afterEach(() => {
  delete process.env.TELEGRAM_DATE_TIME;
});

describe("tashkentUnix", () => {
  it("is the Tashkent (UTC+5) wall-clock moment", () => {
    expect(tashkentUnix("2026-11-17", "14:00")).toBe(Date.UTC(2026, 10, 17, 9, 0) / 1000);
    // date only → noon Tashkent = 07:00 UTC: the same calendar day from UTC−7 to UTC+12
    expect(tashkentUnix("2026-12-01")).toBe(Date.UTC(2026, 11, 1, 7, 0) / 1000);
    // agrees with the platform's tz database
    const d = new Date(tashkentUnix("2026-07-05", "09:30") * 1000);
    expect(d.toLocaleString("en-GB", { timeZone: "Asia/Tashkent", hour12: false })).toBe("05/07/2026, 09:30:00");
  });
});

describe("tgTime", () => {
  it("wraps the text in a date_time entity only when switched on; the format matches Bot API's r|w?[dD]?[tT]?", () => {
    expect(tgTime("17.11.2026 14:00", 1, "dt", false)).toBe("17.11.2026 14:00");
    expect(tgTime("17.11.2026 14:00", 1795424400, "dt", true)).toBe('<tg-time unix="1795424400" format="dt">17.11.2026 14:00</tg-time>');
    for (const f of ["d", "dt", "wdt"]) expect(f).toMatch(/^(r|w?[dD]?[tT]?)$/);
  });
  it("stripTgTime gives back the plain message", () => {
    const on = tgTime("01.12.2026", 5, "d", true);
    expect(stripTgTime(`x ${on} y <b>z</b>`)).toBe("x 01.12.2026 y <b>z</b>");
  });
});

describe("notifications with TELEGRAM_DATE_TIME", () => {
  const absent = { center: "Ilm", student: "Ali", group: "IELTS-1", date: "2026-11-17", time: "14:00" };
  const trial = { ...absent, address: "Amir Temur 5" };
  const rem = { center: "Ilm", student: "Ali", group: "IELTS-1", amount: 600_000, date: "2026-12-01", payUrl: null };

  it("off (default): texts are byte-for-byte what they were", () => {
    expect(msg.absent("uz", absent)).toBe("❗️ <b>Ilm</b>\nAli bugungi darsga kelmadi: IELTS-1, 17.11.2026 14:00");
    expect(msg.reminder("ru", rem)).toBe("🔔 <b>Ilm</b>\nAli — IELTS-1\nОплата за новый месяц с 01.12.2026: <b>600 000 сум</b>");
    expect(msg.trialBooked("uz", trial)).toContain("\n17.11.2026 14:00\n");
  });
  it("on: lesson times are dt entities, payment dates d entities at noon; the old text stays inside", () => {
    process.env.TELEGRAM_DATE_TIME = "true";
    const at = tashkentUnix("2026-11-17", "14:00");
    expect(msg.absent("uz", absent)).toContain(`<tg-time unix="${at}" format="dt">17.11.2026 14:00</tg-time>`);
    expect(msg.absent("ru", absent)).toContain(`<tg-time unix="${at}" format="dt">17.11.2026 14:00</tg-time>`);
    expect(msg.trialBooked("ru", trial)).toContain(`<tg-time unix="${at}" format="dt">17.11.2026 14:00</tg-time>`);
    const due = `<tg-time unix="${tashkentUnix("2026-12-01")}" format="d">01.12.2026</tg-time>`;
    expect(msg.reminder("uz", rem)).toContain(`${due} dan yangi oy uchun to'lov`);
    expect(richMsg.reminder("ru", rem)).toContain(`Оплата за новый месяц с ${due}`);
  });
  it("on: the SMS made from the text is identical to the SMS with the flag off", () => {
    const off = [msg.absent("uz", absent), msg.trialBooked("ru", trial), msg.reminder("uz", rem)].map(htmlToSms);
    process.env.TELEGRAM_DATE_TIME = "true";
    const on = [msg.absent("uz", absent), msg.trialBooked("ru", trial), msg.reminder("uz", rem)].map(htmlToSms);
    expect(on).toEqual(off);
  });
});
