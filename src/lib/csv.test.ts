import { describe, expect, it } from "vitest";
import { csvCell, toCsv } from "./csv";

describe("csv", () => {
  it("starts with a UTF-8 BOM and uses CRLF", () => {
    const s = toCsv(["Ism", "Сумма"], [["Ali", 600000]]);
    expect(s.charCodeAt(0)).toBe(0xfeff);
    expect(s).toContain("Ism,Сумма\r\nAli,600000\r\n");
  });
  it("quotes commas, quotes and newlines", () => {
    expect(csvCell('a,"b"\nc')).toBe('"a,""b""\nc"');
  });
  it("neutralises spreadsheet formulas but keeps negative numbers", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("-50000")).toBe("-50000");
    expect(csvCell(-50000)).toBe("-50000");
  });
});

import { parseCsv } from "./csv-parse";

describe("csv parse", () => {
  it("reads quoted cells, BOM and ; separators", () => {
    expect(parseCsv('﻿a,b\r\n"x, y","say ""hi"""\r\n')).toEqual([["a", "b"], ["x, y", 'say "hi"']]);
    expect(parseCsv("Ism;Telefon\nAli;901234567\n\n")).toEqual([["Ism", "Telefon"], ["Ali", "901234567"]]);
  });
});
