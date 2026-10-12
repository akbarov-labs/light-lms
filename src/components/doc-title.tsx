"use client";

import { useEffect } from "react";
import { BRAND } from "@/config/brand";

/** Sets the browser tab title from the page heading (pages are dynamic; one place to keep it in sync). */
export function DocTitle({ title }: { title: string }) {
  useEffect(() => {
    document.title = `${title} · ${BRAND.name}`;
  }, [title]);
  return null;
}
