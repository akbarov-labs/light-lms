"use client";

import { useEffect, useRef } from "react";

/** Maps the text picked from the student datalist to a hidden studentId input. */
export function StudentIdBridge({ students }: { students: { id: string; label: string }[] }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const form = ref.current?.form;
    const text = form?.elements.namedItem("studentLabel") as HTMLInputElement | null;
    if (!text || !ref.current) return;
    const sync = () => {
      const hit = students.find((s) => s.label === text.value);
      ref.current!.value = hit?.id ?? "";
      text.setCustomValidity(hit ? "" : "?");
    };
    text.addEventListener("input", sync);
    sync();
    return () => text.removeEventListener("input", sync);
  }, [students]);
  return <input ref={ref} type="hidden" name="studentId" />;
}
