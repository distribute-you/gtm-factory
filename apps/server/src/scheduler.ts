/**
 * The in-process scheduler: a tick every minute (first one ~60 s after boot), one tick at a time
 * (mutex). Each live campaign of ours recomputes its Plan and serves its Engines through the
 * runner (runner.ts), the most advanced first, scripts running their code from the database in
 * the sandbox, vendors mocked. A test of a stated length ends on its day.
 */

import { one, q } from "./db";
import { loadCatalogue, loadEvidence, todayUtc, todaysRating, type Brand, type CampaignRow } from "./factory";
import { CapReached, runCampaign, type CampaignCtx } from "./runner";

export const TICK_SECONDS = 60;
const MAX_FAILED_ATTEMPTS = 3;

let running: Promise<void> | null = null;
let timer: NodeJS.Timeout | null = null;

export function isTicking(): boolean {
  return running !== null;
}

export function startScheduler(): void {
  setTimeout(() => {
    void tick();
    timer = setInterval(() => void tick(), TICK_SECONDS * 1000);
  }, Number(process.env.FIRST_TICK_DELAY_MS ?? 60_000));
}

export function stopScheduler(): void {
  if (timer) clearInterval(timer);
}

/** Tick now (right after a launch, so the first tick lands within seconds): after the tick running, if any, a whole tick of its own. */
export async function tickNow(): Promise<void> {
  while (running) await running;
  await tick();
}

/** The scheduler's tick: skipped while one runs (one tick at a time). */
function tick(): Promise<void> {
  if (running) return running;
  running = runTick().finally(() => {
    running = null;
  });
  return running;
}

async function runTick(): Promise<void> {
  const started = Date.now();
  try {
    // A test of a stated length ends on its day: the campaign pauses.
    await q(`UPDATE campaigns SET status = 'paused' WHERE status = 'live' AND factory = 'ours' AND ends_on IS NOT NULL AND ends_on <= (now() AT TIME ZONE 'UTC')::date`);
    const campaigns = await q<CampaignRow>(`SELECT * FROM campaigns WHERE status = 'live' AND factory = 'ours' ORDER BY launched_at`);
    if (campaigns.length > 0) {
      const catalogue = await loadCatalogue();
      const ev = await loadEvidence(catalogue);
      for (const c of campaigns) {
        const brand = await one<Brand>(`SELECT * FROM brands WHERE id = $1`, [c.brand_id]);
        if (!brand) continue;
        const ctx: CampaignCtx = { catalogue, ev, campaign: c, brand, log: [] };
        try {
          await todaysRating(brand.id);
          await runCampaign(ctx);
          if (c.cap_reached_on && c.cap_reached_on !== todayUtc()) await q(`UPDATE campaigns SET cap_reached_on = NULL WHERE id = $1`, [c.id]);
        } catch (e) {
          if (e instanceof CapReached) {
            await q(`INSERT INTO campaign_events (campaign_id, kind, detail) SELECT $1, 'cap_reached', $2 WHERE NOT EXISTS (SELECT 1 FROM campaign_events WHERE campaign_id = $1 AND kind = 'cap_reached' AND at::date = now()::date)`, [c.id, JSON.stringify({ message: e.message })]);
          } else {
            console.error(`[tick] campaign ${c.id}: ${e instanceof Error ? e.stack : String(e)}`);
            await q(`INSERT INTO campaign_events (campaign_id, kind, detail) VALUES ($1, 'error', $2)`, [c.id, JSON.stringify({ message: String(e instanceof Error ? e.message : e) })]);
          }
        }
        await q(`UPDATE campaigns SET last_tick_at = now() WHERE id = $1`, [c.id]);
      }
    }
    await q(`UPDATE scheduler_state SET last_tick_at = now(), last_error = NULL, ticks = ticks + 1 WHERE id = 1`);
  } catch (e) {
    console.error(`[tick] ${e instanceof Error ? e.stack : String(e)}`);
    await q(`UPDATE scheduler_state SET last_tick_at = now(), last_error = $1 WHERE id = 1`, [String(e instanceof Error ? e.message : e)]).catch(() => undefined);
  } finally {
    const ms = Date.now() - started;
    if (ms > 5000) console.log(`[tick] done in ${ms} ms`);
  }
}
