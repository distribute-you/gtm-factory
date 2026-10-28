import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ApiShell } from "@/components/api/shell";
import "./globals.css";
import "./keel.css";

const sans = Geist({ subsets: ["latin"], variable: "--font-geist-sans" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });

export const metadata: Metadata = {
  title: "GTM Factory: revenue made easy",
  description: "An open GTM Factory on a fictional brand: see how the Supplier rating picks every script, template and LLM by value per dollar.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>
        <ApiShell>{children}</ApiShell>
      </body>
    </html>
  );
}
