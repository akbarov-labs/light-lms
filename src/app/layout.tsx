import "./globals.css";
import type { ReactNode } from "react";

export const metadata = { title: "lms-light" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="uz">
      <body className="bg-slate-50 text-slate-900 antialiased">{children}</body>
    </html>
  );
}
