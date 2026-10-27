/**
 * Reliability: the third measured property of a leg's or a script's output,
 * beside yield and cost. Whoever attests an outcome is a leg (an AI judge
 * reading a reply, a CRM import, a website tracker). A producer's reliability
 * on an outcome is its agreement with the outcome's reference leg on the same
 * subjects. A client counts in an outcome's figures only where a reliable
 * producer covers it; the others are left out, never counted as zero.
 */

import { betaMean, type BetaPosterior } from "./stats";

/** One subject a producer looked at for an outcome, and whether it attested it. */
export interface Attestation {
  /** A leg id or a script id. */
  producer: string;
  outcome: string;
  brandId: string;
  subject: string;
  attested: boolean;
}

export interface ProducerReliability {
  producer: string;
  outcome: string;
  agreements: number;
  /** Attested by the producer, not by the reference. */
  producerOnly: number;
  /** Attested by the reference on a subject the producer looked at and did not attest. */
  referenceOnly: number;
  posterior: BetaPosterior;
  reliability: number;
  isReference: boolean;
}

/**
 * Measure every producer against the reference of each outcome, on the
 * clients the reference covers. `reference` maps an outcome to its reference
 * producer; `referenceCovers` lists, per outcome, the clients it covers.
 */
export function measureReliability(
  attestations: readonly Attestation[],
  reference: Readonly<Record<string, string>>,
  referenceCovers: Readonly<Record<string, ReadonlySet<string>>>,
): ProducerReliability[] {
  const key = (b: string, s: string) => `${b}\u0000${s}`;
  const refAttested = new Map<string, Set<string>>();
  const looked = new Map<string, Map<string, boolean>>();
  for (const a of attestations) {
    if (reference[a.outcome] === a.producer && a.attested) {
      let s = refAttested.get(a.outcome);
      if (!s) refAttested.set(a.outcome, (s = new Set()));
      s.add(key(a.brandId, a.subject));
    }
    const pk = `${a.producer}\u0000${a.outcome}`;
    let m = looked.get(pk);
    if (!m) looked.set(pk, (m = new Map()));
    const k = key(a.brandId, a.subject);
    m.set(k, (m.get(k) ?? false) || a.attested);
  }
  const out: ProducerReliability[] = [];
  for (const pk of [...looked.keys()].sort()) {
    const [producer, outcome] = pk.split("\u0000") as [string, string];
    if (reference[outcome] === producer) {
      out.push({ producer, outcome, agreements: 0, producerOnly: 0, referenceOnly: 0, posterior: { alpha: 1, beta: 0 }, reliability: 1, isReference: true });
      continue;
    }
    const covers = referenceCovers[outcome] ?? new Set<string>();
    const ref = refAttested.get(outcome) ?? new Set<string>();
    let agreements = 0;
    let producerOnly = 0;
    let referenceOnly = 0;
    for (const [k, attested] of looked.get(pk)!) {
      if (!covers.has(k.split("\u0000")[0]!)) continue;
      const r = ref.has(k);
      if (attested && r) agreements++;
      else if (attested) producerOnly++;
      else if (r) referenceOnly++;
    }
    const posterior = { alpha: 1 + agreements, beta: 1 + producerOnly + referenceOnly };
    out.push({ producer, outcome, agreements, producerOnly, referenceOnly, posterior, reliability: betaMean(posterior), isReference: false });
  }
  return out;
}

/** How sure we are an outcome happened, from the producers that attested it: 1 - product of (1 - reliability). */
export function confidenceOf(producers: readonly string[], outcome: string, reliability: readonly ProducerReliability[]): number {
  let miss = 1;
  for (const p of producers) miss *= 1 - (reliability.find((r) => r.producer === p && r.outcome === outcome)?.reliability ?? 0);
  return 1 - miss;
}

export interface OutcomeCoverage {
  outcome: string;
  /** Clients with a reliable producer on this outcome: they count in its figures. */
  counted: string[];
  /** Clients without one: left out, never read as zero. */
  leftOut: string[];
}

/** Which clients count in each outcome's figures: those a producer with reliability >= the bar covers. */
export function outcomeCoverage(
  clients: readonly string[],
  producersByClient: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>>,
  reliability: readonly ProducerReliability[],
  minReliability: number,
): OutcomeCoverage[] {
  const outcomes = [...new Set(reliability.map((r) => r.outcome))].sort();
  return outcomes.map((outcome) => {
    const counted: string[] = [];
    const leftOut: string[] = [];
    for (const c of clients) {
      const producers = producersByClient[c]?.[outcome] ?? [];
      const ok = producers.some((p) => (reliability.find((r) => r.producer === p && r.outcome === outcome)?.reliability ?? 0) >= minReliability);
      (ok ? counted : leftOut).push(c);
    }
    return { outcome, counted, leftOut };
  });
}
