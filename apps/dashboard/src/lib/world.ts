/**
 * The simulated world the dashboard plays: scenarios (fictional clients), the world they build on
 * distribute.you's public catalogue, and the actions a visitor can take while it runs. Every action
 * is data, logged with the day it happened, so a reload replays the same history byte for byte.
 */

import {
  START,
  SimulationSession,
  extendWorldWithOption,
  extendWorldWithPipe,
  fictionalWorld,
  loadSeedCatalogue,
  type Pipe,
  type Play,
  type SimClient,
  type Trigger,
  type WorldSpec,
  type Workflow,
  type SeedFile,
} from "@gtm-factory/engine";
import seedFile from "../../../../seed/distribute-catalogue.json";

export interface Scenario {
  id: string;
  name: string;
  /** One line: who the fictional clients are. */
  description: string;
  seed: number;
  clients: number;
  /** Share of optional steps each offer leaves out. */
  stepDropRate: number;
  /** Lifetime revenue per client, dollars (undefined = the client did not state one). */
  lifetimeRevenues: (number | undefined)[];
  /** Daily budget per client, dollars. */
  dailyBudgets: number[];
}

export const SCENARIOS: Scenario[] = [
  {
    id: "starter",
    name: "Four B2B clients",
    description: "A data firm, a logistics firm, a dental lab and a design studio, each with its own offer.",
    seed: 11,
    clients: 4,
    stepDropRate: 0.25,
    lifetimeRevenues: [900, 600, 1200, undefined],
    dailyBudgets: [120, 90, 70, 60],
  },
  {
    id: "busy",
    name: "Six clients, mixed offers",
    description: "Six fictional firms with different steps, budgets and buyers.",
    seed: 7,
    clients: 6,
    stepDropRate: 0.3,
    lifetimeRevenues: [1200, 500, 800, 600, 1500, undefined],
    dailyBudgets: [150, 60, 90, 80, 120, 50],
  },
  {
    id: "lean",
    name: "Lean offers",
    description: "Four firms whose offers skip many steps, so fewer funnels fit.",
    seed: 23,
    clients: 4,
    stepDropRate: 0.5,
    lifetimeRevenues: [1200, 2000, 800, undefined],
    dailyBudgets: [80, 100, 70, 60],
  },
];

export const DEFAULT_SCENARIO = SCENARIOS[0]!;

export function scenarioById(id: string): Scenario {
  return SCENARIOS.find((s) => s.id === id) ?? DEFAULT_SCENARIO;
}

const ENTRY_YIELD_FACTOR = 0.25;

/** Build a scenario's world on the public catalogue. */
export function buildWorld(scenario: Scenario, seed: number): WorldSpec {
  const { catalogue } = loadSeedCatalogue(seedFile as unknown as SeedFile);
  const world = fictionalWorld(catalogue, { seed, clients: scenario.clients, stepDropRate: scenario.stepDropRate });
  world.clients.forEach((c, i) => {
    const ltr = scenario.lifetimeRevenues[i];
    if (ltr === undefined) delete c.offer.lifetimeRevenue;
    else c.offer.lifetimeRevenue = ltr;
    c.campaign.dailyBudgetCents = Math.round((scenario.dailyBudgets[i] ?? 80) * 100);
  });
  // A harder market than the engine's default world: the first touch of a cold lead lands less often.
  for (const t of world.truth.pipes) {
    const pipe = catalogue.pipe(t.pipeId) ?? world.catalogue.pipe(t.pipeId);
    if (pipe && (pipe.from === START || pipe.from === "lead_found")) t.baseYield = Math.round(t.baseYield * ENTRY_YIELD_FACTOR * 10_000) / 10_000;
  }
  return world;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export type CatalogueKind = "pipes" | "workflows" | "triggers" | "plays" | "channels" | "steps" | "slotOptions" | "tactics" | "strategies";

export type SimAction =
  | { type: "launch"; client: SimClient }
  | { type: "status"; campaignId: string; status: "running" | "paused" }
  | { type: "budget"; campaignId: string; dailyBudgetCents: number; maxVolume?: number }
  | { type: "retire"; kind: CatalogueKind; id: string }
  | { type: "restore"; kind: CatalogueKind; id: string }
  | { type: "addPipe"; pipe: Pipe }
  | { type: "addWorkflow"; workflow: Workflow }
  | { type: "addTrigger"; trigger: Trigger }
  | { type: "addPlay"; play: Play }
  | { type: "editPipe"; id: string; name?: string; maturityDays?: number }
  | { type: "editWorkflow"; id: string; costPerTrialCents?: number }
  | { type: "editTrigger"; id: string; label?: string; description?: string };

export interface LoggedAction {
  day: number;
  action: SimAction;
}

type Mutable = Record<string, unknown>;

function find(world: WorldSpec, kind: CatalogueKind, id: string): Mutable | undefined {
  const c = world.catalogue;
  const list: readonly unknown[] = c[kind];
  return list.find((x) => {
    const r = x as Mutable;
    return (kind === "steps" ? r.key : kind === "channels" ? r.slug : r.id) === id;
  }) as Mutable | undefined;
}

/** Apply one action to a running world. Throws on an action the catalogue refuses. */
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
      session.setCampaignBudget(action.campaignId, action.dailyBudgetCents, action.maxVolume);
      return;
    case "retire":
      c.retire(action.kind, action.id);
      return;
    case "restore": {
      const item = find(world, action.kind, action.id);
      if (!item) throw new Error(`${action.kind} "${action.id}" not found`);
      if (action.kind === "workflows" || action.kind === "slotOptions") item.status = "active";
      else delete item.retired;
      return;
    }
    case "addPipe":
      c.add("pipes", structuredClone(action.pipe));
      extendWorldWithPipe(world, action.pipe.id);
      return;
    case "addWorkflow":
      c.add("workflows", structuredClone(action.workflow));
      extendWorldWithOption(world, "workflows", action.workflow.id);
      return;
    case "addTrigger":
      c.add("triggers", structuredClone(action.trigger));
      return;
    case "addPlay":
      c.add("plays", structuredClone(action.play));
      return;
    case "editPipe": {
      const p = c.pipe(action.id) as unknown as Mutable | undefined;
      if (!p) throw new Error(`pipe "${action.id}" not found`);
      if (action.name !== undefined) p.name = action.name;
      if (action.maturityDays !== undefined) {
        const m = p.maturity as Pipe["maturity"];
        p.maturity = { ...m, durationDays: action.maturityDays, delayMeanDays: action.maturityDays / 3 };
      }
      return;
    }
    case "editWorkflow": {
      const w = c.workflow(action.id) as unknown as Mutable | undefined;
      if (!w) throw new Error(`workflow "${action.id}" not found`);
      if (action.costPerTrialCents !== undefined) w.costPerTrialCents = Math.max(0, Math.round(action.costPerTrialCents));
      return;
    }
    case "editTrigger": {
      const t = c.trigger(action.id) as unknown as Mutable | undefined;
      if (!t) throw new Error(`trigger "${action.id}" not found`);
      if (action.label !== undefined) t.label = action.label;
      if (action.description !== undefined) t.description = action.description;
      return;
    }
  }
}

/** Build a world and play it to `day`, applying each logged action on its day. */
export function replay(scenario: Scenario, seed: number, actions: readonly LoggedAction[], day: number): { world: WorldSpec; session: SimulationSession; applied: LoggedAction[] } {
  const world = buildWorld(scenario, seed);
  const session = new SimulationSession(world);
  const applied: LoggedAction[] = [];
  const applyDue = (d: number) => {
    for (const a of actions) {
      if (a.day !== d) continue;
      try {
        applyAction(world, session, a.action);
        applied.push(a);
      } catch (e) {
        console.error("[gtm-factory] a logged action could not be replayed", a, e);
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
