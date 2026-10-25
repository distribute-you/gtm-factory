/**
 * Evidence: how we KNOW an outcome happened. A reply, a click, a booking is
 * evidence of a lead state, reported by a reporter (the client's CRM, a
 * website tracker, an AI judge reading a reply, a person's statement, an API
 * push).
 *
 * Each reporter has a MEASURED reliability per outcome: its agreement with the
 * outcome's reference reporter on the clients both cover. That number decides
 * how much its evidence counts. A client counts in an outcome's figures only
 * when a reliable reporter covers that outcome for them; the others are left
 * out, never counted as 0. No list of trusted reporters anywhere: the
 * reference per outcome and the reliability bar are data.
 */

import type { StepKey } from "./catalogue";
import { betaMean, type BetaPosterior } from "./stats";

export interface Reporter {
  id: string;
  name: string;
}

/** A reporter is connected for a client and can report these outcomes. */
export interface ReporterConnection {
  reporterId: string;
  clientId: string;
  outcomes: StepKey[];
}

export interface Evidence {
  reporterId: string;
  clientId: string;
  /** The lead or object the evidence is about. */
  subject: string;
  outcome: StepKey;
  day: number;
}

export interface EvidencePolicy {
  /** Per outcome, the reporter other reporters are measured against. */
  referenceReporter: Record<StepKey, string>;
  /** Reliability a reporter needs for its coverage to count a client in. */
  minReliability: number;
}

export interface ReporterReliability {
  reporterId: string;
  outcome: StepKey;
  /** Subjects both the reporter and the reference reported. */
  agreements: number;
  /** Subjects only the reporter reported. */
  reporterOnly: number;
  /** Subjects only the reference reported. */
  referenceOnly: number;
  /** Beta(1 + agreements, 1 + disagreements): its mean is the reliability. */
  posterior: BetaPosterior;
  reliability: number;
  isReference: boolean;
}

const key = (clientId: string, subject: string) => `${clientId}\u0000${subject}`;

/**
 * Measure each reporter's reliability per outcome, on the clients where both
 * it and the reference are connected for that outcome.
 */
export function measureReliability(
  evidence: readonly Evidence[],
  connections: readonly ReporterConnection[],
  policy: EvidencePolicy,
): ReporterReliability[] {
  const covers = (reporterId: string, clientId: string, outcome: StepKey) =>
    connections.some((c) => c.reporterId === reporterId && c.clientId === clientId && c.outcomes.includes(outcome));
  const pairs = new Set<string>();
  for (const c of connections) for (const o of c.outcomes) pairs.add(`${c.reporterId}\u0000${o}`);
  const out: ReporterReliability[] = [];
  for (const pair of [...pairs].sort()) {
    const [reporterId, outcome] = pair.split("\u0000") as [string, string];
    const reference = policy.referenceReporter[outcome];
    if (reference === reporterId) {
      out.push({ reporterId, outcome, agreements: 0, reporterOnly: 0, referenceOnly: 0, posterior: { alpha: 1, beta: 0 }, reliability: 1, isReference: true });
      continue;
    }
    const shared = new Set(
      connections
        .filter((c) => c.reporterId === reporterId && c.outcomes.includes(outcome) && reference !== undefined && covers(reference, c.clientId, outcome))
        .map((c) => c.clientId),
    );
    const mine = new Set<string>();
    const theirs = new Set<string>();
    for (const e of evidence) {
      if (e.outcome !== outcome || !shared.has(e.clientId)) continue;
      if (e.reporterId === reporterId) mine.add(key(e.clientId, e.subject));
      if (e.reporterId === reference) theirs.add(key(e.clientId, e.subject));
    }
    let agreements = 0;
    for (const k of mine) if (theirs.has(k)) agreements++;
    const reporterOnly = mine.size - agreements;
    const referenceOnly = theirs.size - agreements;
    const posterior = { alpha: 1 + agreements, beta: 1 + reporterOnly + referenceOnly };
    out.push({ reporterId, outcome, agreements, reporterOnly, referenceOnly, posterior, reliability: betaMean(posterior), isReference: false });
  }
  return out;
}

export interface AttestedOccurrence {
  clientId: string;
  subject: string;
  outcome: StepKey;
  /** First day any reporter reported it. */
  day: number;
  reporters: string[];
  /** 1 - product over reporters of (1 - reliability): how sure we are it happened. */
  credence: number;
}

/** Merge evidence into occurrences, each weighted by its reporters' reliability. */
export function attest(evidence: readonly Evidence[], reliability: readonly ReporterReliability[]): AttestedOccurrence[] {
  const rel = new Map(reliability.map((r) => [`${r.reporterId}\u0000${r.outcome}`, r.reliability]));
  const groups = new Map<string, AttestedOccurrence>();
  for (const e of evidence) {
    const k = `${e.clientId}\u0000${e.subject}\u0000${e.outcome}`;
    const g = groups.get(k) ?? { clientId: e.clientId, subject: e.subject, outcome: e.outcome, day: e.day, reporters: [], credence: 0 };
    g.day = Math.min(g.day, e.day);
    if (!g.reporters.includes(e.reporterId)) g.reporters.push(e.reporterId);
    groups.set(k, g);
  }
  for (const g of groups.values()) {
    let miss = 1;
    for (const r of g.reporters) miss *= 1 - (rel.get(`${r}\u0000${g.outcome}`) ?? 0);
    g.credence = 1 - miss;
    g.reporters.sort();
  }
  return [...groups.values()];
}

export interface OutcomeCoverage {
  outcome: StepKey;
  /** Clients with a reliable reporter on this outcome: they count in its figures. */
  counted: string[];
  /** Clients without one: left out of its figures, never read as 0. */
  leftOut: string[];
}

/** Which clients count in each outcome's figures. */
export function outcomeCoverage(
  clients: readonly string[],
  outcomes: readonly StepKey[],
  connections: readonly ReporterConnection[],
  reliability: readonly ReporterReliability[],
  policy: EvidencePolicy,
): OutcomeCoverage[] {
  const rel = new Map(reliability.map((r) => [`${r.reporterId}\u0000${r.outcome}`, r.reliability]));
  return outcomes.map((outcome) => {
    const counted: string[] = [];
    const leftOut: string[] = [];
    for (const clientId of clients) {
      const reliable = connections.some(
        (c) =>
          c.clientId === clientId &&
          c.outcomes.includes(outcome) &&
          (rel.get(`${c.reporterId}\u0000${outcome}`) ?? 0) >= policy.minReliability,
      );
      (reliable ? counted : leftOut).push(clientId);
    }
    return { outcome, counted, leftOut };
  });
}
