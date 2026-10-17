import { describe, expect, it } from "vitest";
import { debtSinceColumn, parseImportDate } from "./import-parse";

describe("import: debt-since date", () => {
  it("reads dd.MM.yyyy, d.M.yyyy, dd/MM/yyyy and yyyy-MM-dd", () => {
    expect(parseImportDate("15.08.2026")).toBe("2026-08-15");
    expect(parseImportDate("5.8.2026")).toBe("2026-08-05");
    expect(parseImportDate("05/08/2026")).toBe("2026-08-05");
    expect(parseImportDate("2026-08-15")).toBe("2026-08-15");
    expect(parseImportDate(" 2026-8-5 ")).toBe("2026-08-05");
  });
  it("rejects dates that do not exist or are not dates", () => {
    for (const s of ["31.02.2026", "29.02.2026", "2026-13-01", "00.01.2026", "15.08.26", "yesterday", "", "2026/08/15"]) expect(parseImportDate(s)).toBeNull();
    expect(parseImportDate("29.02.2028")).toBe("2028-02-29");
  });
  it("finds the column by header name, else the 7th", () => {
    expect(debtSinceColumn(null)).toBe(6);
    expect(debtSinceColumn(["Familiya", "Ism", "Telefon", "Ota-ona", "Guruh", "Balans"])).toBe(6);
    expect(debtSinceColumn(["Familiya", "Ism", "Telefon", "Ota-ona", "Guruh", "Balans", "Izoh", "qarz_sanasi"])).toBe(7);
    expect(debtSinceColumn(["a", "b", "c", "d", "e", "f", "debt_since"])).toBe(6);
    expect(debtSinceColumn(["a", "b", "c", "d", "e", "f", "g", "Дата долга"])).toBe(7);
  });
});
