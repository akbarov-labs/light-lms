import { describe, expect, it } from "vitest";
import { msg } from "./messages";
import { richAttendance, richMsg, richTable } from "./rich-messages";

/** The words of a plain message (tags and URLs out), to check the rich form says the same thing. */
const words = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .split(/[\s:.,()—]+/u)
    .filter((w) => w.length > 1);

describe("richTable", () => {
  it("is a compact bordered table of label | value and drops rows without a value", () => {
    expect(richTable([["A & B", "1"], ["C", null]])).toBe('<table bordered compact><tr><td>A &amp; B</td><td align="right">1</td></tr></table>');
    expect(richTable([["C", null]])).toBe("");
  });
});

describe("richMsg keeps the plain texts' wording", () => {
  const card = { center: "Ilm <Markaz>", student: "Ali Valiyev", group: "IELTS-1", month: "2026-10", attendancePct: 92, gradeAvg: 4.5, url: "https://lms.uz/rc/abc" };
  const pay = { center: "Ilm", student: "Ali Valiyev", amount: 450_000, balance: -50_000, date: "2026-11-17" as const };
  const debt = { center: "Ilm", debt: 300_000, payUrl: "https://lms.uz/pay/f1" };
  const rem = { center: "Ilm", student: "Ali Valiyev", group: "IELTS-1", amount: 600_000, date: "2026-12-01" as const, payUrl: "https://lms.uz/pay/f1" };
  for (const l of ["uz", "ru"] as const) {
    it(`${l}: every word of the plain text is in the rich form`, () => {
      const pairs: [string, string][] = [
        [msg.reportCard(l, card), richMsg.reportCard(l, card)],
        [msg.paymentReceived(l, pay), richMsg.paymentReceived(l, pay)],
        [msg.debt(l, debt), richMsg.debt(l, debt)],
        [msg.reminder(l, rem), richMsg.reminder(l, rem)],
      ];
      for (const [plain, rich] of pairs) {
        const have = new Set(words(rich));
        expect(words(plain).filter((w) => !have.has(w))).toEqual([]);
      }
    });
  }

  it("report card: heading, month heading and a table; names are escaped; the link is kept", () => {
    const r = richMsg.reportCard("uz", card);
    expect(r.startsWith("<h3>📘 Ilm &lt;Markaz&gt;</h3>")).toBe(true);
    expect(r).toContain("<h4>Oktyabr 2026 oyi hisoboti</h4>");
    expect(r).toContain('<tr><td>Davomat</td><td align="right">92%</td></tr>');
    expect(r).toContain('<tr><td>O\'rtacha baho</td><td align="right">4.5</td></tr>');
    expect(r).toContain("<p>https://lms.uz/rc/abc</p>");
    expect(r).not.toMatch(/<(?!\/?(h3|h4|p|b|table|tr|td)\b)[^>]*>/);
  });
  it("report card with no marks has no table", () => {
    expect(richMsg.reportCard("ru", { ...card, attendancePct: null, gradeAvg: null })).not.toContain("<table");
  });
  it("debt / reminder without a pay link have no pay line", () => {
    expect(richMsg.debt("uz", { ...debt, payUrl: null })).not.toContain("To'lash");
    expect(richMsg.reminder("ru", { ...rem, payUrl: null })).not.toContain("Оплатить:");
  });
});

describe("richAttendance", () => {
  it("one heading + compact table per child; the grade column only when a child has grades", () => {
    const html = richAttendance({
      title: "✅ Davomat, kun (30)",
      children: [
        { name: "Ali <A>", present: 1, total: 2, rows: [{ date: "16.11", mark: "✓", grade: 5, group: "G1" }, { date: "14.11", mark: "✗", grade: null, group: "G1" }] },
        { name: "Laylo", present: 1, total: 1, rows: [{ date: "16.11", mark: "✓", grade: null, group: "G2" }] },
        { name: "Bobur", present: 0, total: 0, rows: [] },
      ],
    });
    expect(html).toContain("<h3>✅ Davomat, kun (30)</h3>");
    expect(html).toContain("<h4>👤 Ali &lt;A&gt; — 1/2</h4>");
    expect(html).toContain('<tr><td>16.11</td><td align="center">✓</td><td align="center">5</td><td>G1</td></tr>');
    expect(html).toContain('<tr><td>14.11</td><td align="center">✗</td><td align="center"></td><td>G1</td></tr>');
    expect(html).toContain('<tr><td>16.11</td><td align="center">✓</td><td>G2</td></tr>');
    expect(html).toContain("<h4>👤 Bobur — 0/0</h4>");
    expect(html.match(/<table/g)).toHaveLength(2);
  });
});
