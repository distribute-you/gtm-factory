"use client";

import { ArrowSquareOutIcon } from "@phosphor-icons/react";
import { Mark, type MarkKind } from "@/components/mark";
import { Page, PageHeader, TopBar } from "@/components/ui";
import { REPO_URL } from "@/components/shell";

const SECTIONS: { kind: MarkKind; title: string; lines: string[] }[] = [
  {
    kind: "outcome",
    title: "Outcomes and Units",
    lines: [
      "An outcome is a part reference: Lead interested, Message sent, Template. A Unit is one physical piece of it: Marie, interested on day 24.",
      "Every API call output is an outcome. A cold email is Message written, then Message queued by our send call, then Message sent and Reply received, reported by the mailbox.",
      "Lead states sit on a lead track: lead interested, then meeting booked, then meeting attended, then paid client. Tracks are never added together.",
    ],
  },
  {
    kind: "leg",
    title: "Legs, and the Bill of materials of each script",
    lines: [
      "A leg goes from one outcome to another, performed by competing scripts. Each script declares its own Bill of materials: a writer with a company research, another without.",
      "Every leg runs the same code. Pull asks for Units that fit a Specification: the subject, conditions, a quantity. Push hands it one Unit to advance. It picks a script, serves it each Material from the stock, else pulls that outcome from the best producer, then runs it.",
      "A Specification names the outcome, never a producer: the brand context of my lead's organisation, younger than 90 days. Whichever leg is picked receives it, like a purchase order names a part, not a machine.",
    ],
  },
  {
    kind: "campaign",
    title: "The Campaign orders production",
    lines: [
      "A Campaign fixes only its Target, its budget and its strategy (Channel is cold email). Its production tree is rebuilt at every tick from performance.",
      "From Start it is proactive: it pulls from the Target down, each Material from the stock, else from the best producer. From any other outcome it is reactive: it pushes each Unit that lands up toward the Target.",
      "The sales path and the sales funnel are views: the tree actually used, with a short name to talk about it. A Unit advances one leg per tick, since every run takes time.",
      "A follow-up campaign starts from Message sent. Its script waits its days since the last message, then writes. Who is never served, such as people who asked to stop, is the strategy's choice.",
    ],
  },
  {
    kind: "object",
    title: "The ledger is the common stock",
    lines: [
      "Every Unit lands in one stock, whoever made it: our legs, the client's team, the client's CRM, the organic market. Several producers feed one outcome.",
      "A leg serves itself from the stock when a Unit fits its Specification. When none does, it orders one from a producer it chooses. A Unit never wears out: several campaigns can consume it.",
      "A webhook is the script of a leg another factory calls: the CRM reports an interested lead, the mailbox reports a message sent. Its Units land in the stock and push the reactive campaigns that start from them.",
    ],
  },
  {
    kind: "script:ai",
    title: "Scripts",
    lines: [
      "A script performs a leg. Several compete on each leg. Each belongs to a dynasty with versions: an upgrade keeps the dynasty's stats, a fork starts from its parent's.",
      "A script owns its business logic in its leg storage: who to pick, when to run, what to remember. The storage holds notes and references to Units, never copies.",
    ],
  },
  {
    kind: "point",
    title: "The Supplier rating",
    lines: [
      "A leg cannot judge its candidates from its own data: a template's replies land later, in another leg. The Supplier rating leg reads the ledger and the traceability and makes a Rating each tick.",
      "The choosing leg takes the Rating as a Material and picks: Thompson sampling on value per dollar, pooled from the script's level everywhere down to the client. The Rating's cost goes to the legs that consume it.",
    ],
  },
  {
    kind: "play",
    title: "Credit through traceability",
    lines: [
      "Every Unit records the choices that led to it, its own included, and those carried by the Units it consumed.",
      "When the next lead state lands, every choice on that record is credited. A template is judged on the reply it brings, never on how easily it gets written.",
    ],
  },
  {
    kind: "strategy",
    title: "Tactics and strategies",
    lines: [
      "A tactic is a typed property: yes or no, a value from a list, or a number. The same tactics describe scripts, leads and Units.",
      "A strategy is a set of conditions on tactics, per Material of one leg: pro models at the writer's LLM completion, a 60 day recontact window at the identity's Lead found. Its conditions enter the Specification.",
      "One split mechanism reads typed tactics. Splits on leads propose a finer ICP; splits on scripts propose a strategy.",
    ],
  },
  {
    kind: "factory",
    title: "Other factories and reliability",
    lines: [
      "Every Unit names its producer: one of our runs, or another factory at its access cost. Our return counts only what our runs produced.",
      "Reliability is measured: a producer's agreement with the outcome's reference leg on the same subjects.",
      "Decisions read each leg's own cost and yield. Reports read the every-path cost of each outcome. A Unit keeps the price paid to make it, reuse shows as a gain, and the books reconcile to the cent.",
    ],
  },
];

export function HowItWorksPage() {
  return (
    <>
      <TopBar crumbs={[{ label: "How it works" }]} />
      <Page narrow>
        <PageHeader
          title="Revenue made easy, as a factory"
          sub="Go-to-market as a factory: Campaigns order a Target, legs make outcomes, scripts compete inside each leg with their own Bill of materials, and every choice goes where a dollar returns the most."
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
