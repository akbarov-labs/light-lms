import "./globals.css";
import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { isLocale, LANG_COOKIE } from "@/lib/i18n";

export const metadata = { title: { default: "lms-light", template: "%s · lms-light" }, other: { google: "notranslate" } };

export default async function RootLayout({ children }: { children: ReactNode }) {
  const lang = (await cookies()).get(LANG_COOKIE)?.value;
  return (
    // translate="no": the UI has its own uz/ru switch; browser auto-translate rewrites React's text nodes
    // before hydration (hydration error #418, then "removeChild" crashes on the next update).
    <html lang={isLocale(lang) ? lang : "uz"} translate="no" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
