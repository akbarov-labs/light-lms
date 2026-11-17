import { describe, expect, it } from "vitest";
import { latinToCyrillic as cyr } from "./translit";

describe("latinToCyrillic", () => {
  it("handles the Uzbek letters made of two characters", () => {
    expect(cyr("o'qituvchi")).toBe("ўқитувчи");
    expect(cyr("og'ir")).toBe("оғир");
    expect(cyr("oʻgʻil")).toBe("ўғил"); // the modifier-letter apostrophe too
    expect(cyr("shanba, chorshanba")).toBe("шанба, чоршанба");
    expect(cyr("Yunusobod, Bunyodkor")).toBe("Юнусобод, Бунёдкор");
    expect(cyr("yozilish, yangi, Yevropa")).toBe("ёзилиш, янги, Европа");
    expect(cyr("yo'l")).toBe("йўл");
  });

  it("writes э at the start of a word and after a vowel, ъ for the glottal stop", () => {
    expect(cyr("ertaga ega poezd dars")).toBe("эртага эга поэзд дарс");
    expect(cyr("ma'lumot, mas'ul")).toBe("маълумот, масъул");
  });

  it("keeps capitals", () => {
    expect(cyr("Dilnoza Karimova, Shahzoda, Chilonzor, O'zbekiston")).toBe("Дилноза Каримова, Шаҳзода, Чилонзор, Ўзбекистон");
  });

  it("turns a real agent reply into Cyrillic and leaves numbers and punctuation alone", () => {
    expect(cyr("Narxi oyiga 650 000 so'm. Dars 18.11.2026, chorshanba 16:00-17:30.")).toBe("Нархи ойига 650 000 сўм. Дарс 18.11.2026, чоршанба 16:00-17:30.");
  });

  it("leaves links, handles, tags, entities, abbreviations, codes with digits and brands as written", () => {
    expect(cyr("https://t.me/sabaquz_bot?start=demo")).toBe("https://t.me/sabaquz_bot?start=demo");
    expect(cyr("@its_akbarov va info@sabaq.uz")).toBe("@its_akbarov ва info@sabaq.uz");
    expect(cyr("/start bosing yoki /lang")).toBe("/start босинг ёки /lang");
    expect(cyr("<b>DTM Matematika</b> &amp; IELTS")).toBe("<b>DTM Математика</b> &amp; IELTS");
    expect(cyr("GE-A1 guruhi, Payme yoki Click orqali")).toBe("GE-A1 гуруҳи, Payme ёки Click орқали");
  });

  it("passes Cyrillic (Uzbek or Russian) through unchanged and quotes stay quotes", () => {
    expect(cyr("Ассалому алайкум! Здравствуйте.")).toBe("Ассалому алайкум! Здравствуйте.");
    expect(cyr("'Sinov' tugmasi")).toBe("'Синов' тугмаси");
  });
});
