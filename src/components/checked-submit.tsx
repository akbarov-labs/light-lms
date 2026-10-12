"use client";

import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2, Send } from "lucide-react";
import { buttonClass } from "./ui";

/** Submit button that counts the ticked checkboxes of its form and confirms before sending. */
export function CheckedCountSubmit({ name, label, confirm, selectAllLabel }: { name: string; label: string; confirm: string; selectAllLabel: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [n, setN] = useState(0);
  const { pending } = useFormStatus();
  const boxes = () => [...(ref.current?.closest("form")?.querySelectorAll<HTMLInputElement>(`input[type=checkbox][name="${name}"]:not(:disabled)`) ?? [])];
  useEffect(() => {
    const form = ref.current?.closest("form");
    const count = () => setN(boxes().filter((b) => b.checked).length);
    count();
    form?.addEventListener("change", count);
    return () => form?.removeEventListener("change", count);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div ref={ref} className="flex items-center gap-3">
      <button
        type="button"
        className="text-[13px] text-zinc-600 underline-offset-2 hover:text-zinc-900 hover:underline"
        onClick={() => {
          const all = boxes();
          const every = all.every((b) => b.checked);
          all.forEach((b) => (b.checked = !every));
          setN(every ? 0 : all.length);
        }}
      >
        {selectAllLabel}
      </button>
      <button
        type="submit"
        disabled={n === 0 || pending}
        className={buttonClass("secondary", "sm")}
        onClick={(e) => {
          if (!window.confirm(confirm.replace("{n}", String(n)))) e.preventDefault();
        }}
      >
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Send className="h-3.5 w-3.5" aria-hidden />}
        {label.replace("{n}", String(n))}
      </button>
    </div>
  );
}
