// Renders question text with its $…$ formulas through KaTeX (server or client, no hooks). A formula KaTeX
// cannot parse shows its source in red instead of breaking the page.
import katex from "katex";
import "katex/dist/katex.min.css";
import { splitMath } from "@/lib/math-text";

export function MathText({ text, className }: { text: string; className?: string }) {
  const parts = splitMath(text);
  return (
    <span className={className}>
      {parts.map((p, i) =>
        p.math ? (
          <span
            key={i}
            // KaTeX escapes the source itself; trust stays off, so no \href or raw HTML gets through
            dangerouslySetInnerHTML={{ __html: katex.renderToString(p.s, { throwOnError: false, strict: "ignore", trust: false, output: "html" }) }}
          />
        ) : (
          <span key={i}>{p.s}</span>
        ),
      )}
    </span>
  );
}
