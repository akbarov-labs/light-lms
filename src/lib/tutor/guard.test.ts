import { describe, expect, it } from "vitest";
import { finalValues, leakedQuestion, looksLikeSheet, namedQuestions } from "./guard";

// an open homework: 1) B  2) -4  3) 3/4  4) 2.5  5) 12
const KEYS = [["B", "-4", "3/4", "2.5", "12"]];

describe("leakedQuestion", () => {
  it("catches a question named with a word and its key", () => {
    expect(leakedQuestion("2-misolning javobi: -4", KEYS)).toBe(2);
    expect(leakedQuestion("Ответ к задаче 3: 0,75", KEYS)).toBe(3);
    expect(leakedQuestion("Задача 3: ответ 0,75", KEYS)).toBe(3);
    expect(leakedQuestion("№1 — B.", KEYS)).toBe(1);
    expect(leakedQuestion("5-savol: 12", KEYS)).toBe(5);
    expect(leakedQuestion("2-мисол жавоби: −4", KEYS)).toBe(2);
  });

  it("compares numbers by value, letters in either script", () => {
    expect(leakedQuestion("4-masala: 2,5", KEYS)).toBe(4);
    expect(leakedQuestion("4-masala: 5/2", KEYS)).toBe(4);
    expect(leakedQuestion("1-savol: В.", KEYS)).toBe(1); // Cyrillic В = B
  });

  it("catches an answer list, not one numbered step", () => {
    expect(leakedQuestion("1) B 2) -4", KEYS)).toBe(1);
    expect(leakedQuestion("Javoblar:\n2) -4", KEYS)).toBe(2);
    // a numbered explanation whose step happens to hold a key number
    expect(leakedQuestion("1) Avval qavslarni ochamiz.\n2) -4 ni o'ngga o'tkazamiz va soddalashtiramiz.", KEYS)).toBeNull();
  });

  it("catches a final answer when the student named the question", () => {
    expect(leakedQuestion("Demak, x = -4", KEYS, "2-misolni tushuntirib bering")).toBe(2);
    expect(leakedQuestion("Javob: 12", KEYS, "5) 3x = 36 ni qanday yechaman?")).toBe(5);
    expect(leakedQuestion("Shunday qilib, 0,75 chiqadi:\n3 : 4 = 0,75", KEYS, "Задача 3")).toBe(3);
    // the same final answer with no question named anywhere is the prompt's job
    expect(leakedQuestion("Demak, x = -4", KEYS, "2x + 8 = 0 ni qanday yechaman?")).toBeNull();
  });

  it("lets hints and a similar problem with another answer through", () => {
    const hint = "2-misolda avval 8 ni o'ng tomonga o'tkazing. Keyin ikkala tomonni 2 ga bo'ling. Nima chiqdi?";
    expect(leakedQuestion(hint, KEYS, "2-misolni tushunmadim")).toBeNull();
    const similar = "O'xshash misol: 3x + 9 = 0.\n3x = -9\nx = -3\nEndi o'zingiz 2-misolni xuddi shunday yeching.";
    expect(leakedQuestion(similar, KEYS, "2-misolni yecha olmadim")).toBeNull();
  });

  it("ignores Russian words that look like letters, and no keys at all", () => {
    expect(leakedQuestion("Задача 1: В ней нужно найти x.", KEYS)).toBeNull();
    expect(leakedQuestion("в 1) в", KEYS)).toBeNull();
    expect(leakedQuestion("2-misol: -4", [])).toBeNull();
    expect(leakedQuestion("2-misol: -4", [[]])).toBeNull();
  });

  it("reads through HTML and emphasis", () => {
    expect(leakedQuestion("<b>2-misol</b>: <b>-4</b>", KEYS)).toBe(2);
    expect(leakedQuestion("**Javob:** -4", KEYS, "№2")).toBe(2);
  });

  it("checks every open homework", () => {
    expect(leakedQuestion("1-savol: C", [["A"], ["C"]])).toBe(1);
  });
});

describe("namedQuestions / finalValues", () => {
  it("finds question numbers in the forms students write", () => {
    expect([...namedQuestions("5-misol va 7 masala, задача 9, №11, #12")].sort((a, b) => a - b)).toEqual([5, 7, 9, 11, 12]);
    expect([...namedQuestions("3) 2x=6")]).toEqual([]);
    expect([...namedQuestions("3) 2x=6", true)]).toEqual([3]);
  });

  it("finds final answers, not intermediate equalities", () => {
    expect(finalValues("2x + 3 = 11, ya'ni 2x = 8").map((f) => f.value)).toEqual(["8"]);
    expect(finalValues("Javob: B").map((f) => f.value)).toEqual(["B"]);
    expect(finalValues("x = 4y + 1").map((f) => f.value)).toEqual([]);
  });
});

describe("looksLikeSheet", () => {
  it("spots a list of numbered problems", () => {
    expect(looksLikeSheet("1) 2x+3=7\n2) 3x-1=8\n3) x/2=5")).toBe(true);
    expect(looksLikeSheet("1. 2+2\n2. 3+3\n3. 4+4")).toBe(true);
    expect(looksLikeSheet("1) 2x+3=7 2) 3x-1=8 3) x/2=5 4) 5x=10")).toBe(true);
  });

  it("lets a single question or two through", () => {
    expect(looksLikeSheet("2x + 3 = 11 ni qanday yechaman?")).toBe(false);
    expect(looksLikeSheet("5) 2x+3=7 shuni tushunmadim")).toBe(false);
    expect(looksLikeSheet("1) 2x=4\n2) 3x=9")).toBe(false);
    expect(looksLikeSheet("f(1) = 3, f(2) = 5, f(3) = ?")).toBe(false);
    expect(looksLikeSheet("1, 2, 3 sonlarining yig'indisi")).toBe(false);
  });
});
