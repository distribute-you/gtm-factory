import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ApiCampaignDetail, ApiConnectedAccount, ApiOverview, ApiScriptStats } from "@gtm-factory/core";
import { buildModel } from "./model";
import { simRoute } from "./sim-backend";
import { WORLD, applyAction, replay } from "./world";

describe("the simulator answers the factory API", () => {
  const { world, session } = replay(WORLD.seed, [], 12);
  const host = { model: buildModel(world, session), dispatch: (a: Parameters<typeof applyAction>[2]) => (applyAction(world, session, a), null) };
  const get = <T,>(path: string) => simRoute(host, "GET", path, undefined) as T;

  it("every read the pages make answers", () => {
    const o = get<ApiOverview>("/overview");
    expect(o.campaigns.length).toBe(5);
    const brand = o.brands[0]!.id;
    const c = get<ApiCampaignDetail>("/campaigns/campaign-outbound");
    expect(c.plan?.outcome).toBe("paid_client");
    expect(c.milestones.length).toBeGreaterThan(2);
    for (const path of ["/catalogue", "/brands", `/brands/${brand}/plans`, "/campaigns", "/leads", "/objects?outcome=template_written", "/scripts", "/research", "/picks", `/tasks?brandId=${brand}`, `/accounts?brandId=${brand}`, "/ledger"]) expect(() => get(path), path).not.toThrow();
    expect(get<ApiScriptStats[]>("/scripts").find((s) => s.id === "ce_morning")?.source).toContain("ctx.accounts(");
  });

  it("writes go through the logged actions: a role change shows in the next read", () => {
    const brand = get<ApiOverview>("/overview").brands[0]!.id;
    simRoute(host, "PATCH", "/accounts/mb-jo", { role: "Personal" });
    expect(get<ApiConnectedAccount[]>(`/accounts?brandId=${brand}`).find((a) => a.id === "mb-jo")?.role).toBe("Personal");
  });

  it("an unknown route answers a named error, never a guess", () => {
    expect(() => get("/nothing")).toThrow(/does not answer/);
  });
});

describe("one UI", () => {
  it("no page reads the simulator directly: every page reads the factory API", () => {
    const root = join(__dirname, "../components");
    const files: string[] = [];
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = join(d, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (f.endsWith(".tsx")) files.push(p);
      }
    };
    walk(root);
    for (const f of files) {
      if (f.endsWith("sim-bar.tsx")) continue;
      const text = readFileSync(f, "utf8");
      expect(text, f).not.toMatch(/@\/lib\/(sim|model|world|plan|campaigns)"/);
    }
  });
});
