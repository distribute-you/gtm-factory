"use client";

import { ArrowSquareOutIcon } from "@phosphor-icons/react";
import { Mark, type MarkKind } from "@/components/mark";
import { Page, PageHeader, TopBar } from "@/components/ui";
import { REPO_URL } from "@/lib/data-source";

const SECTIONS: { kind: MarkKind; title: string; lines: string[] }[] = [
  {
    kind: "outcome",
    title: "Outcomes and Units",
    lines: [
      "An outcome is a part reference: Reply received, Message sent, Template. A Unit is one physical piece of it: Marie's reply on day 24.",
      "Every call a script makes to the outside world lands as an outcome. A cold email is Message written, then Message queued, then Message sent and Reply received, reported by the mailbox.",
      "Milestones sit on a Track: Lead interested, then Meeting booked, then Meeting attended, then Paid client. Tracks are never added together.",
    ],
  },
  {
    kind: "engine",
    title: "One Engine per outcome",
    lines: [
      "An Engine makes one outcome. Competing scripts perform it: cold email and LinkedIn are two scripts of the Reply received Engine. The only pick is the script, by return on each dollar.",
      "An Engine has two calls. Pull makes one new piece for a subject. Push takes a Unit that just landed and makes the next outcome from it.",
    ],
  },
  {
    kind: "script:ai",
    title: "Scripts are code",
    lines: [
      "A script is a file of plain code a person or an AI reads and edits. A change is a new version of its dynasty; a fork starts a new dynasty from its parent's results.",
      "Its code calls the Providers of the outcomes it needs, at run time. A judge reads the code to list them, then the ledger measures what each run really consumed.",
      "Freshness is the script's call: unhappy with what it got, it asks again and a new piece is made, as long as the run's budget lasts.",
    ],
  },
  {
    kind: "material",
    title: "Providers",
    lines: [
      "One Provider per outcome, never in competition. Its one call returns the most recent Unit this caller has not received yet, for the run's subject, from the stock, else ordered from the Engine.",
      "Every Unit lands in one stock, whoever made it: our scripts, the client's team, the client's CRM, the organic market. A Unit never wears out: several campaigns can consume it.",
    ],
  },
  {
    kind: "campaign",
    title: "The Campaign and its Plan",
    lines: [
      "A Campaign fixes only its Target, its start, its budget and a brief in plain words. A judge reads the brief once per Engine: the strategy it keeps, or none, daily caps and a test length.",
      "Its Plan is recomputed at every tick: from the Target down, each Engine with its best script now, its total cost and its return. From Start it pulls; from any other outcome it pushes each Unit that lands up toward the Target.",
      "The page shows the Plan as what actually ran this week: every script that made Units is a branch, with its share and cost. Nothing is frozen.",
    ],
  },
  {
    kind: "performer",
    title: "Performed by",
    lines: [
      "Every script carries who performs it: Ours, Client's team, Mailbox, CRM, Organic market. Budget and return count only what we perform.",
      "A Client's team script costs us nothing; its limit is its capacity, typed by a person on the Done by your team page. Out of capacity today, the Plan routes around it until tomorrow.",
    ],
  },
  {
    kind: "point",
    title: "The Supplier rating",
    lines: [
      "A script cannot judge its candidates from its own data: a template's replies land later. The Supplier rating reads the ledger and the traceability and makes a Rating each day.",
      "Every pick takes the Rating and picks: Thompson sampling on value per dollar, pooled from the script's level everywhere down to the client. A branch is rated as it will be once the picks under it sit at their best.",
      "Every Unit records the picks that led to it. When the next milestone lands, every pick on that record is credited.",
    ],
  },
  {
    kind: "strategy",
    title: "Tactics and strategies",
    lines: [
      "A tactic is a typed property: yes or no, a value from a list, or a number. The same tactics describe scripts, people and Units.",
      "A strategy is a set of conditions on tactics, per Engine: pro models for LLM completions, a 60 day recontact window for Lead found, nobody who asked to stop for Message written.",
      "One split mechanism reads typed tactics. Splits on people propose a finer ICP; splits on scripts propose a strategy.",
    ],
  },
];

export function HowItWorksPage() {
  return (
    <>
      <TopBar crumbs={[{ label: "How it works" }]} />
      <Page narrow>
        <PageHeader
          title="Revenue made easy, built like a production line"
          sub="Campaigns order a Target, one Engine makes each outcome, scripts compete inside each Engine, and every pick goes where a dollar returns the most."
          right={
            <a href={`${REPO_URL}/blob/main/docs/framework.md`} target="_blank" rel="noreferrer" className="k-btn">
              Read the spec
              <ArrowSquareOutIcon size={13} />
            </a>
          }
        />
        <div className="space-y-3">
          {SECTIONS.map((s) => (
            <section key={s.title} className="k-card flex gap-4 p-5">
              <Mark kind={s.kind} id={s.title} size={36} />
              <div className="min-w-0">
                <h2 className="text-[16px] font-medium">{s.title}</h2>
                <div className="k-fg2 mt-1.5 space-y-1.5 text-[13px] leading-6">
                  {s.lines.map((l, i) => (
                    <p key={i}>{l}</p>
                  ))}
                </div>
              </div>
            </section>
          ))}
        </div>
      </Page>
    </>
  );
}
