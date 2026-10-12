"use client";

import { useEffect } from "react";

/** Sets the browser tab title from the page heading (pages are dynamic; one place to keep it in sync). */
export function DocTitle({ title }: { title: string }) {
  useEffect(() => {
    document.title = `${title} · lms-light`;
  }, [title]);
  return null;
}
