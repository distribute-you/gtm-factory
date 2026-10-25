import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Shell } from "@/components/shell";
import { SimProvider } from "@/lib/sim";
import "./globals.css";
import "./keel.css";

const sans = Geist({ subsets: ["latin"], variable: "--font-geist-sans" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });

export const metadata: Metadata = {
  title: "GTM Factory: revenue made easy",
  description: "An open agentic GTM factory, live. Pick a client, ask for paid clients, and watch the engine choose every funnel, workflow, template and LLM by value per dollar.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>
        <SimProvider>
          <Shell>{children}</Shell>
        </SimProvider>
      </body>
    </html>
  );
}
