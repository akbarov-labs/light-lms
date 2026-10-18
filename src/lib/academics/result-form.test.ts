import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/services/exams", () => ({}));
const { parseResultForm } = await import("./result-form");

describe("parseResultForm", () => {
  it("groups fields per student / lead, blank = null, decimal comma read", () => {
    const fd = new FormData();
    fd.set("examId", "e1");
    fd.set("s:stu1:total", " 72 ");
    fd.set("s:stu1:comment", "yaxshi");
    fd.set("s:stu2:total", "");
    fd.set("l:lead1:sec:0", "12");
    fd.set("l:lead1:sec:1", "7,5");
    fd.set("x:bad:total", "9");
    fd.set("s:../..:total", "9");
    expect(parseResultForm(fd)).toEqual([
      { studentId: "stu1", sections: [], total: 72, comment: "yaxshi" },
      { studentId: "stu2", sections: [], total: null },
      { leadId: "lead1", sections: [12, 7.5] },
    ]);
  });
});
