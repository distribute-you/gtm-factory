import { SimulationSession, worldFromData, type WorldData } from "../src";
import { worldData } from "./helpers";

/**
 * The worked pull example of docs/framework.md: one client, Acme, one campaign
 * ordering Meetings booked with a $10 daily budget and 20 new subjects a day,
 * one script per leg and every yield at 1, so each tick reads like a story.
 */
export function acmeWorld(): WorldData {
  const w = worldData();
  const keep = new Set(["rating_pooled", "offer_client", "icp_client_states", "tpl_copywriter", "ctx_full", "glm", "src_filters", "id_merge", "ef_lookup", "cr_site", "wr_research", "ce_morning", "mb_send", "mb_replies", "rj_ai", "bk_slots"]);
  for (const s of w.catalogue.scripts) if (!keep.has(s.id)) s.status = "retired";
  const client = w.clients.find((c) => c.brand.id === "brand-2")!;
  client.brand = { ...client.brand, name: "Acme" };
  client.org = { ...client.org, name: "Acme" };
  client.connected = ["email_delivery"];
  client.organicPerDay = 0;
  client.truthMultiplier = 1;
  client.seeds = client.seeds.filter((s) => s.dynasty === "offer" || s.dynasty === "icp-client" || s.dynasty === "tpl-story");
  client.campaigns = [{ ...client.campaigns[0]!, name: "Meetings for Acme", target: "meeting_booked", dailyBudgetCents: 1000, volume: { units: 20, periodDays: 1 }, strategies: {} }];
  w.clients = [client];
  for (const p of Object.values(w.truth.legs)) {
    p.base = 1;
    p.delayMeanDays = 0;
    p.horizonDays = 0;
    delete p.onFalseInput;
  }
  for (const s of Object.values(w.truth.scripts)) {
    delete s.step;
    delete s.end;
    delete s.coverage;
  }
  w.truth.at = {};
  w.truth.segments = [];
  w.settings = { ...w.settings, ticksPerDay: 1, setupCentsPerBrand: 0, peoplePerCompany: 4000, splitEveryDays: 1000 };
  return w;
}

export function acmeSession(days: number): SimulationSession {
  const s = new SimulationSession(worldFromData(acmeWorld()));
  s.run(days);
  return s;
}
