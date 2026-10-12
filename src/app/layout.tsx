import "./globals.css";
import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { isLocale, LANG_COOKIE } from "@/lib/i18n";

export const metadata = { title: { default: "lms-light", template: "%s · lms-light" } };

export default async function RootLayout({ children }: { children: ReactNode }) {
  const lang = (await cookies()).get(LANG_COOKIE)?.value;
  return (
    <html lang={isLocale(lang) ? lang : "uz"} className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
