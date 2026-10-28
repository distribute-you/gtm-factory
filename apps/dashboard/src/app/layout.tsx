import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { SimulatorBar } from "@/components/sim-bar";
import { SimProvider } from "@/lib/sim";
import { ApiShell } from "@/components/api/shell";
import { IS_API } from "@/lib/data-source";
import "./globals.css";
import "./keel.css";

const sans = Geist({ subsets: ["latin"], variable: "--font-geist-sans" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });

export const metadata: Metadata = {
  title: "GTM Factory: revenue made easy",
  description: "An open agentic GTM factory, live. Pick a client, ask for paid clients, and watch the Supplier rating pick every funnel, script, template and LLM by value per dollar.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>
        {IS_API ? (
          <ApiShell>{children}</ApiShell>
        ) : (
          <SimProvider>
            <ApiShell top={<SimulatorBar />}>{children}</ApiShell>
          </SimProvider>
        )}
      </body>
    </html>
  );
}
