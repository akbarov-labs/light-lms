// Text with formulas: math sits between $…$ as LaTeX (\frac{3}{4}, \sqrt{x+1}, \overline{ab}), the rest is
// plain text. `\$` is a literal dollar sign; an unclosed $ is plain text too, so a typo never hides words.

export type MathPart = { math: boolean; s: string };

export function splitMath(text: string): MathPart[] {
  const parts: MathPart[] = [];
  let plain = "";
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === "\\" && text[i + 1] === "$") {
      plain += "$";
      i += 2;
      continue;
    }
    if (c === "$") {
      // the closing $ that is not escaped
      let j = i + 1;
      while (j < text.length && !(text[j] === "$" && text[j - 1] !== "\\")) j++;
      const inner = text.slice(i + 1, j).trim();
      if (j < text.length && inner) {
        if (plain) parts.push({ math: false, s: plain });
        plain = "";
        parts.push({ math: true, s: inner });
        i = j + 1;
        continue;
      }
    }
    plain += c;
    i++;
  }
  if (plain) parts.push({ math: false, s: plain });
  return parts;
}

/** True when the text carries at least one formula. */
export const hasMath = (text: string) => splitMath(text).some((p) => p.math);
