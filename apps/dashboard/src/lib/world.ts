/**
 * The simulated world the dashboard plays: the fictional world published as data
 * (seed/fictional-world.json), and the actions a visitor can take while it runs. Every
 * action is data, logged with the day it happened, so a reload replays the same history
 * byte for byte. No scenario number lives here: tuning is the world's data.
 */

import { SimulationSession, worldFromData, type CatalogueData, type Script, type WorldClient, type WorldData, type WorldSpec } from "@gtm-factory/core";
import worldJson from "../../../../seed/fictional-world.json";
import distributeJson from "../../../../seed/distribute-world.json";

export const WORLD: WorldData = worldJson as unknown as WorldData;

/** The scenarios the simulator plays: each a world as data. */
export const SCENARIOS = {
  fictional: { label: "Fictional world", data: WORLD },
  distribute: { label: "distribute.you catalogue", data: distributeJson as unknown as WorldData },
} as const;
export type ScenarioId = keyof typeof SCENARIOS;
export const SCENARIO_IDS = Object.keys(SCENARIOS) as ScenarioId[];

export function scenarioData(id: ScenarioId): WorldData {
  return (SCENARIOS[id] ?? SCENARIOS.fictional).data;
}

export type CatalogueKind = Exclude<keyof CatalogueData, "salesPaths" | "salesFunnels">;

export type SimAction =
  | { type: "launch"; client: WorldClient }
  | { type: "status"; campaignId: string; status: "running" | "paused" }
  | { type: "budget"; campaignId: string; dailyBudgetCents: number }
  | { type: "strategy"; campaignId: string; legId: string; strategyId: string }
  | { type: "retire"; kind: CatalogueKind; id: string }
  | { type: "restore"; kind: CatalogueKind; id: string }
  | { type: "upgradeScript"; dynasty: string; id: string; name: string; costCents?: number }
  | { type: "forkScript"; parentDynasty: string; script: Omit<Script, "parentDynasty" | "version" | "legId" | "status"> }
  | { type: "objectVersion"; brandId: string; outcome: string; dynasty: string; text: string; name?: string }
  | { type: "objectFork"; brandId: string; outcome: string; parentDynasty: string; dynasty: string; text: string; name?: string };

export interface LoggedAction {
  day: number;
  action: SimAction;
}

export function buildWorld(seed: number, scenario: ScenarioId = "fictional"): WorldSpec {
  return worldFromData(scenarioData(scenario), seed);
}

/** Apply one action to a running world. Throws on an action the engine refuses. */
export function applyAction(world: WorldSpec, session: SimulationSession, action: SimAction): void {
  const c = world.catalogue;
  switch (action.type) {
    case "launch":
      session.addClient(structuredClone(action.client));
      return;
    case "status":
      session.setCampaignStatus(action.campaignId, action.status);
      return;
    case "budget":
      session.setCampaignBudget(action.campaignId, action.dailyBudgetCents);
      return;
    case "strategy":
      session.setCampaignStrategy(action.campaignId, action.legId, action.strategyId);
      return;
    case "retire":
      c.retire(action.kind, action.id);
      return;
    case "restore":
      c.restore(action.kind, action.id);
      return;
    case "upgradeScript":
      c.upgrade(action.dynasty, { id: action.id, name: action.name, ...(action.costCents !== undefined ? { costCents: action.costCents } : {}) });
      return;
    case "forkScript":
      c.fork(action.parentDynasty, structuredClone(action.script));
      return;
    case "objectVersion":
      session.addObjectVersion(action.brandId, action.outcome, action.dynasty, { text: action.text, ...(action.name ? { name: action.name } : {}) });
      return;
    case "objectFork":
      session.forkObject(action.brandId, action.outcome, action.parentDynasty, { dynasty: action.dynasty, text: action.text, ...(action.name ? { name: action.name } : {}) });
      return;
  }
}

/** Build the world and play it to `day`, applying each logged action on its day. */
export function replay(seed: number, actions: readonly LoggedAction[], day: number, scenario: ScenarioId = "fictional"): { world: WorldSpec; session: SimulationSession; applied: LoggedAction[] } {
  const world = buildWorld(seed, scenario);
  const session = new SimulationSession(world);
  const applied: LoggedAction[] = [];
  const applyDue = (d: number) => {
    for (const a of actions) {
      if (a.day !== d) continue;
      try {
        applyAction(world, session, a.action);
        applied.push(a);
      } catch (e) {
        console.warn("[gtm-factory] a logged action could not be replayed", a, e);
      }
    }
  };
  while (session.day < day) {
    applyDue(session.day);
    session.step();
  }
  applyDue(session.day);
  return { world, session, applied };
}
