"use client";

import { ErrorView } from "@/components/error-view";

// Inside the admin shell: navigation stays usable, only the page area shows the error.
export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorView error={error} reset={reset} />;
}
