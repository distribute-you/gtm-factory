"use client";

import { ArrowSquareOutIcon } from "@phosphor-icons/react";
import { Mark, type MarkKind } from "@/components/mark";
import { Page, PageHeader, TopBar } from "@/components/ui";
import { REPO_URL } from "@/components/shell";

const SECTIONS: { kind: MarkKind; title: string; lines: string[] }[] = [
  {
    kind: "outcome",
    title: "Outcomes",
    lines: [
      "An outcome is something reached for a subject: a lead, a company, or an object such as an ICP or a template.",
      "Lead states sit on a lead track: lead interested, then meeting booked, then meeting attended, then paid client. Tracks are never added together.",
    ],
  },
  {
    kind: "pipe",
    title: "Pipes",
    lines: [
      "A pipe turns its inputs into one outcome. It may need several inputs: a message writer needs a verified email, the company research, a template, a brand context and an LLM completion.",
      "An input is produced ahead (an ICP, a template) or on demand (an LLM completion): the consuming script asks the engine, the engine runs a provider script, one run makes one occurrence.",
      "Identity is a pipe too: who a raw record is, in the one id space every pipe shares.",
    ],
  },
  {
    kind: "script:ai",
    title: "Scripts",
    lines: [
      "A script performs a pipe. Several compete on each pipe. Each belongs to a dynasty with versions: an upgrade keeps the dynasty's stats, a fork starts from its parent's.",
      "One run is one script. A run that does not produce its outcome is a run without it, never a fallback to another script.",
      "A script owns its business logic (who to pick, when to pick again, what to remember) in its pipe storage. Nobody else reads that storage: data moves between pipes only through occurrences.",
    ],
  },
  {
    kind: "trigger",
    title: "Triggers",
    lines: [
      "One generic trigger: when an outcome is reached, after a delay, unless another outcome is reached meanwhile. Each event is itself an occurrence.",
      "A campaign can start from a trigger instead of the market: a follow-up campaign wakes 4 days after a message, unless a reply came.",
    ],
  },
  {
    kind: "point",
    title: "The input choice",
    lines: [
      "Every choice lives on an input: the play of a leg, the script providing an input, the occurrence to consume. One prioritizer makes them all.",
      "Thompson sampling on value per dollar: draw a plausible rate and a plausible cost for each option, pick the best draw. Exploration comes by construction.",
      "Beliefs pool: a script's level everywhere it is offered, then this input, then clients sharing tactics, then the client. Delayed outcomes count for the share already due. Costs are measured, with their uncertainty.",
    ],
  },
  {
    kind: "play",
    title: "Credit through traceability",
    lines: [
      "Every occurrence records what led to it: the scripts run, the occurrences consumed, at which input.",
      "When the end of a leg lands, every input choice on that record is credited. A template is judged on the reply it brings, never on how easily it gets written.",
    ],
  },
  {
    kind: "strategy",
    title: "Tactics and strategies",
    lines: [
      "A tactic is a typed property: yes or no, a value from a list, or a number. The same tactics describe scripts and leads.",
      "A strategy is a set of conditions on tactics. Its rules attach to the inputs of one pipe: pro models at the writer's input, a 60 day recontact window at the sourcing input. A play is a pipe with a strategy; a campaign chooses one per pipe, with a default.",
      "One split mechanism reads typed tactics: list values grouped, number thresholds found. Splits on leads propose a finer ICP; splits on scripts propose a strategy.",
    ],
  },
  {
    kind: "factory",
    title: "Other factories and reliability",
    lines: [
      "Every occurrence names its producer: one of our runs, or another factory (your team, your CRM, the organic market) at its access cost.",
      "Everything is counted. Our return values only what our runs produced.",
      "Reliability is measured: a producer's agreement with the outcome's reference pipe on the same subjects.",
    ],
  },
  {
    kind: "object",
    title: "The ledger",
    lines: [
      "Decisions read each pipe's own cost and yield. Reports read the every-path cost of each outcome.",
      "An occurrence keeps the price paid to make it; reuse shows as a gain. The books reconcile to the cent.",
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
          sub="Go-to-market as a factory: outcomes, pipes that make them, scripts that compete inside each pipe, and one engine that puts every dollar where it returns the most."
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
