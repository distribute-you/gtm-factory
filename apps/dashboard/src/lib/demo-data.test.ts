/**
 * The demo's example database: the fictional brand's history, generated once by the simulator
 * (30 days, a fixed seed and a fixed date) and shipped as one JSON file per API read under
 * public/demo. The browser only reads those files: nothing is simulated or computed there.
 * Regenerate with `pnpm --filter dashboard demo-data`; this test fails when the files drift.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ApiCompany, ApiLead, ApiOverview } from "@gtm-factory/core";
import { demoFile, demoKey } from "./demo-key";
import { buildModel } from "./model";
import { setAnchor, simRoute } from "./sim-backend";
import { WORLD, applyAction, replay } from "./world";

const DIR = join(__dirname, "../../public/demo");
const DAYS = 30;
/** The example data's date: the last simulated day is this one. */
const AS_OF = Date.UTC(2026, 9, 28, 9, 0, 0);
const WRITE = process.env.DEMO_WRITE === "1";

function generate(): Map<string, unknown> {
  setAnchor(AS_OF);
  const { world, session } = replay(WORLD.seed, [], DAYS);
  const host = { model: buildModel(world, session), dispatch: (a: Parameters<typeof applyAction>[2]) => (applyAction(world, session, a), null) };
  const out = new Map<string, unknown>();
  const get = <T,>(path: string): T => {
    const key = demoKey(path);
    if (!out.has(key)) out.set(key, simRoute(host, "GET", key, undefined));
    return out.get(key) as T;
  };
  const o = get<ApiOverview>("/overview");
  for (const p of ["/catalogue", "/brands", "/campaigns", "/research", "/ledger", "/scripts", "/picks", "/leads", "/series", "/companies", "/proposals"]) get(p);
  for (const b of o.brands) {
    for (const p of [`/brands/${b.id}/plans`, `/series?brandId=${b.id}`, `/companies?brandId=${b.id}`, `/proposals?brandId=${b.id}`, `/accounts?brandId=${b.id}`, `/tasks?brandId=${b.id}&status=open`]) get(p);
  }
  for (const c of o.campaigns) {
    get(`/campaigns/${c.id}`);
    get(`/leads?campaignId=${c.id}`);
  }
  for (const x of o.catalogue.outcomes) {
    get(`/scripts?outcome=${x.id}`);
    if (x.contentType === "audience" || (o.pins ?? []).some((p) => p.kind === "outcome" && p.id === x.id)) get(`/objects?outcome=${x.id}`);
    if (x.subject === "lead") get(`/leads?state=${x.id}`);
  }
  // Each lead a list shows first, and each company's first lead, opens.
  const leads = new Set<string>();
  for (const [k, v] of [...out]) if (k.startsWith("/leads") && Array.isArray(v)) for (const l of (v as ApiLead[]).slice(0, 50)) leads.add(l.id);
  for (const c of get<ApiCompany[]>("/companies").slice(0, 50)) if (c.leadId) leads.add(c.leadId);
  for (const id of leads) get(`/leads/${id}`);
  setAnchor(null);
  return out;
}

describe("the demo's example database", () => {
  it("is what the simulator generates, one file per read, and holds no hidden truth", () => {
    const data = generate();
    const files = new Map([...data].map(([k, v]) => [demoFile(k), JSON.stringify(v)]));
    expect(files.size).toBe(data.size);
    for (const text of files.values()) expect(text).not.toMatch(/"(truth|hiddenBest|onBest)"/);
    if (WRITE) {
      if (existsSync(DIR)) rmSync(DIR, { recursive: true });
      mkdirSync(DIR, { recursive: true });
      for (const [f, text] of files) writeFileSync(join(DIR, f), text);
      return;
    }
    expect(new Set(readdirSync(DIR))).toEqual(new Set(files.keys()));
    for (const [f, text] of files) expect(readFileSync(join(DIR, f), "utf8"), f).toBe(text);
  }, 600_000);
});
