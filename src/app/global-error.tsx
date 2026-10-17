"use client";
// Last-resort boundary: replaces the root layout when it fails, so it brings its own <html>/<body>.

import "./globals.css";
import { ErrorView } from "@/components/error-view";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="uz" translate="no">
      <body className="font-sans antialiased">
        <ErrorView error={error} reset={reset} fullPage />
      </body>
    </html>
  );
}
