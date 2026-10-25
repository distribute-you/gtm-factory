"use client";

import Link from "next/link";
import { ArrowSquareOutIcon } from "@phosphor-icons/react";
import { Mark, type MarkKind } from "@/components/mark";
import { REPO_URL } from "@/components/shell";
import { CardTable, Page, PageHeader, SectionTitle, TD, TDN, TH, TopBar } from "@/components/ui";

const SPEC = `${REPO_URL}/blob/main/docs/framework.md`;

export function HowItWorksPage() {
  return (
    <>
      <TopBar crumbs={[{ label: "How it works" }]} actions={<a href={SPEC} target="_blank" rel="noreferrer" className="k-btn">Read the spec <ArrowSquareOutIcon size={13} /></a>} />
      <Page narrow>
        <PageHeader title="A factory that turns a market into paying clients" sub="Every station has a cost and a yield. One engine picks the line with the best value per dollar, and keeps learning while it runs." />

        <Section n={1} title="The factory" href={`${SPEC}#1-the-factory`}>
          <p>
            Think of a car plant. Raw material comes in, stations transform it, finished cars roll out. Go-to-market works the same way. The raw material is a market. The finished product is a paying client. In between,
            stations turn one state of a buyer into the next. Some are software, some are AI, some are people.
          </p>
          <div className="k-card mt-4 space-y-3 p-4">
            <Line
              parts={[
                ["start", "Start"],
                ["channel", "Cold email", "envelope"],
                ["step", "Lead interested", "chat-circle-text"],
                ["channel", "AI meeting booking", "calendar-check"],
                ["step", "Meeting booked", "calendar-check"],
                ["channel", "Your team", "handshake"],
                ["step", "Paid client", "currency-dollar"],
              ]}
            />
            <Line
              parts={[
                ["start", "Start"],
                ["channel", "Ads", "search"],
                ["step", "Lead visited", "cursor-click"],
                ["channel", "Website", "browser"],
                ["step", "Signup", "user-plus"],
                ["channel", "Your team", "handshake"],
                ["step", "Paid client", "currency-dollar"],
              ]}
            />
            <p className="k-fg3 text-[12px]">Two sales funnels. Each is a straight line: one channel between every two steps.</p>
          </div>
        </Section>

        <Section n={2} title="Value flows backward, cost flows forward" href={`${SPEC}#3-two-calculations`}>
          <p>
            One occurrence of a step costs what its inputs cost, plus the station&apos;s own cost, divided by its yield. One occurrence is worth what you can make of it, net of what that costs. A paid client is worth the
            offer&apos;s lifetime revenue.
          </p>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <Formula label="Cost, forward from Start" formula="C(to) = (C(from) + c) ÷ y" />
            <Formula label="Value, backward from the target" formula="V(s) = max(0, y × V(to) − c)" />
          </div>
          <p className="mt-4">A client with a lifetime revenue of $2,100, through a meeting:</p>
          <div className="mt-3">
            <CardTable footer="Value per dollar: $2,100 ÷ $700 = 3.0. A funnel is worth funding above 1.">
              <thead>
                <tr className="k-line-subtle border-b">
                  <th className={TH}>Leg</th>
                  <th className={`${TH} text-right`}>$ per input</th>
                  <th className={`${TH} text-right`}>Yield</th>
                  <th className={`${TH} text-right`}>Leads needed</th>
                  <th className={`${TH} text-right`}>$ per paid client</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ["Start to Lead interested, cold email", "$1", "2%", "625", "$625"],
                  ["Lead interested to Meeting booked, AI meeting booking", "$2", "40%", "12.5", "$25"],
                  ["Meeting booked to Paid client, your team", "$10", "20%", "5", "$50"],
                ].map((r) => (
                  <tr key={r[0]} className="k-row">
                    <td className={TD}>{r[0]}</td>
                    <td className={TDN}>{r[1]}</td>
                    <td className={TDN}>{r[2]}</td>
                    <td className={TDN}>{r[3]}</td>
                    <td className={TDN}>{r[4]}</td>
                  </tr>
                ))}
                <tr className="k-row font-medium">
                  <td className={TD}>One paid client</td>
                  <td className={TDN} />
                  <td className={TDN} />
                  <td className={TDN} />
                  <td className={TDN}>$700</td>
                </tr>
              </tbody>
            </CardTable>
          </div>
          <p className="mt-3">Under a budget, the cheapest funnel per paid client wins. The lifetime revenue decides how much to spend, not which funnel.</p>
        </Section>

        <Section n={3} title="One prioritizer for every choice" href={`${SPEC}#4-the-choice-node`}>
          <p>Which funnel, which audience, which workflow, which template, which LLM: every choice is the same problem, solved by the same function.</p>
          <ol className="mt-3 space-y-2">
            {[
              "Each option carries a belief about its yield.",
              "Draw one plausible yield from each belief.",
              "Score each option: value per dollar under the drawn yields.",
              "Pick the highest.",
            ].map((t, i) => (
              <li key={t} className="flex items-start gap-2.5">
                <span className="k-kbd mt-0.5">{i + 1}</span>
                {t}
              </li>
            ))}
          </ol>
          <p className="mt-3">An option with little data has a wide belief, so it sometimes draws high and gets tried. Exploration comes by construction: no quota, no threshold, no special learning phase.</p>
          <SeeIt href="/research/">See it converge on the Research page</SeeIt>
        </Section>

        <Section n={4} title="The fleet and the client, pooled" href={`${SPEC}#5-partial-pooling-the-fleet-and-the-client`}>
          <p>A new client has no data. The fleet has a lot. The estimate pools the two, and the client&apos;s own rate takes over as its data grows. How fast is fitted from how much clients really differ.</p>
        </Section>

        <Section n={5} title="Outcomes that arrive late" href={`${SPEC}#6-delayed-outcomes`}>
          <p>A reply can land weeks after the email. Each trial counts for the share of its outcomes already due at its age. Every figure is also served two ways: flash, everything to date, and mature, only cohorts old enough to judge.</p>
          <SeeIt href="/campaigns/">Switch flash and mature on any campaign</SeeIt>
        </Section>

        <Section n={6} title="Audiences: words first, then the data" href={`${SPEC}#7-segment-discovery`}>
          <p>An expert writes the first audiences from the client&apos;s profile. Then the data looks for a split that performs differently, and only keeps a conclusion that holds like for like, in the same client and the same month.</p>
          <SeeIt href="/audiences/">See the segments and their verdicts</SeeIt>
        </Section>

        <Section n={7} title="Decide versus report" href={`${SPEC}#8-decide-versus-report`}>
          <p>To decide, the engine reads each pipe&apos;s own cost. To report, the ledger prices each outcome every path, inputs included. Both reconcile to the cent.</p>
          <SeeIt href="/ledger/">Open the ledger</SeeIt>
        </Section>

        <Section n={8} title="Evidence" href={`${SPEC}#9-evidence`}>
          <p>A reply, a click or a booking is evidence from a reporter: a CRM, a tracker, an AI judge. Each reporter&apos;s reliability is measured, never assumed, and gives every outcome its confidence.</p>
          <SeeIt href="/leads/">Open a lead to see its evidence</SeeIt>
        </Section>

        <Section n={9} title="Everything is data" href={`${SPEC}#10-adding-a-pipe`}>
          <p>Steps, channels, pipes, triggers, workflows, templates and LLMs are rows in a catalogue. Add one and it competes from the next decision. Retire one and it leaves every choice at once.</p>
          <SeeIt href="/catalogue/">Edit the catalogue live</SeeIt>
        </Section>
      </Page>
    </>
  );
}

function Section({ n, title, href, children }: { n: number; title: string; href: string; children: React.ReactNode }) {
  return (
    <section className="mt-10 max-w-[880px] first-of-type:mt-0">
      <SectionTitle right={<a href={href} target="_blank" rel="noreferrer" className="k-accent">In the spec</a>}>
        <span className="k-fg3 mr-2 tabular-nums">{n}</span>
        {title}
      </SectionTitle>
      <div className="k-fg2 max-w-[760px] space-y-2 text-[14px] leading-6">{children}</div>
    </section>
  );
}

function SeeIt({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <p className="mt-3">
      <Link href={href} className="k-accent text-[13px]">
        {children} →
      </Link>
    </p>
  );
}

function Formula({ label, formula }: { label: string; formula: string }) {
  return (
    <div className="k-card px-4 py-3">
      <span className="k-label">{label}</span>
      <p className="k-mono k-fg mt-1 text-[15px]">{formula}</p>
    </div>
  );
}

function Line({ parts }: { parts: [MarkKind | "start", string, string?][] }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[13px]">
      {parts.map(([kind, label, icon], i) => (
        <span key={i} className="inline-flex items-center gap-1.5">
          {i > 0 && <span className="k-fg4">→</span>}
          <Mark kind={kind === "start" ? "start" : kind} id={label} icon={icon} size={18} quiet={kind === "start"} />
          <span className={kind === "channel" ? "k-fg" : "k-fg2"}>{label}</span>
        </span>
      ))}
    </div>
  );
}
