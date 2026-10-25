"use client";

/**
 * The simulator, held once for the whole app: the world, the session, the day, the play controls,
 * and every action a visitor took (logged with its day, so a reload replays the same history).
 * Pages read one `Model` per simulated day.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { SimulationSession, WorldSpec } from "@gtm-factory/engine";
import { buildModel, type Model } from "./model";
import { DEFAULT_SCENARIO, applyAction, replay, scenarioById, type LoggedAction, type Scenario, type SimAction } from "./world";

const STORAGE_KEY = "gtm-factory:v1";
export const SPEEDS = [1, 2, 4, 8] as const;
export type Speed = (typeof SPEEDS)[number];
/** The day the dashboard opens on for a first visit: enough history to read every page. */
export const FIRST_VISIT_DAY = 30;

interface Saved {
  scenarioId: string;
  seed: number;
  day: number;
  actions: LoggedAction[];
  scope: string | null;
}

interface SimContextValue {
  model: Model | null;
  scenario: Scenario;
  seed: number;
  playing: boolean;
  speed: Speed;
  scope: string | null;
  actions: LoggedAction[];
  setScope: (brandId: string | null) => void;
  play: () => void;
  pause: () => void;
  stepDay: () => void;
  setSpeed: (s: Speed) => void;
  reset: (scenarioId: string, seed: number) => void;
  dispatch: (action: SimAction) => string | null;
}

const SimContext = createContext<SimContextValue | null>(null);

function readSaved(): Saved | null {
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.has("day") || params.has("scenario") || params.has("seed")) {
      const scenario = scenarioById(params.get("scenario") ?? DEFAULT_SCENARIO.id);
      return {
        scenarioId: scenario.id,
        seed: Number(params.get("seed") ?? scenario.seed) || scenario.seed,
        day: Math.max(0, Math.min(365, Number(params.get("day") ?? FIRST_VISIT_DAY) || 0)),
        actions: [],
        scope: null,
      };
    }
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Saved) : null;
  } catch {
    return null;
  }
}

export function SimProvider({ children }: { children: React.ReactNode }) {
  const worldRef = useRef<WorldSpec | null>(null);
  const sessionRef = useRef<SimulationSession | null>(null);
  const [version, setVersion] = useState(0);
  const [scenario, setScenario] = useState<Scenario>(DEFAULT_SCENARIO);
  const [seed, setSeed] = useState<number>(DEFAULT_SCENARIO.seed);
  const [actions, setActions] = useState<LoggedAction[]>([]);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<Speed>(2);
  const [scope, setScope] = useState<string | null>(null);

  const load = useCallback((sc: Scenario, sd: number, acts: LoggedAction[], day: number) => {
    const { world, session, applied } = replay(sc, sd, acts, day);
    worldRef.current = world;
    sessionRef.current = session;
    setScenario(sc);
    setSeed(sd);
    setActions(applied);
    setVersion((v) => v + 1);
  }, []);

  // First load: the saved history (or the URL's), else a first visit opened on day 30.
  useEffect(() => {
    const saved = readSaved();
    if (saved) {
      setScope(saved.scope);
      load(scenarioById(saved.scenarioId), saved.seed, saved.actions, saved.day);
    } else load(DEFAULT_SCENARIO, DEFAULT_SCENARIO.seed, [], FIRST_VISIT_DAY);
  }, [load]);

  const model = useMemo(() => {
    void version;
    return worldRef.current && sessionRef.current ? buildModel(worldRef.current, sessionRef.current) : null;
  }, [version]);

  // Keep the history so a reload lands on the same day.
  useEffect(() => {
    if (!model) return;
    const saved: Saved = { scenarioId: scenario.id, seed, day: model.day, actions, scope };
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    } catch {
      /* storage full or blocked: the session still runs */
    }
  }, [model, scenario, seed, actions, scope]);

  const stepDay = useCallback(() => {
    const s = sessionRef.current;
    if (!s) return;
    s.step();
    setVersion((v) => v + 1);
  }, []);

  useEffect(() => {
    if (!playing) return;
    const t = window.setInterval(stepDay, 1000 / speed);
    return () => window.clearInterval(t);
  }, [playing, speed, stepDay]);

  const dispatch = useCallback((action: SimAction): string | null => {
    const world = worldRef.current;
    const session = sessionRef.current;
    if (!world || !session) return "The simulation is still loading.";
    try {
      applyAction(world, session, action);
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
    setActions((a) => [...a, { day: session.day, action }]);
    setVersion((v) => v + 1);
    return null;
  }, []);

  const value: SimContextValue = {
    model,
    scenario,
    seed,
    playing,
    speed,
    scope,
    actions,
    setScope,
    play: () => setPlaying(true),
    pause: () => setPlaying(false),
    stepDay,
    setSpeed,
    reset: (scenarioId, sd) => {
      setPlaying(false);
      setScope(null);
      load(scenarioById(scenarioId), sd, [], 0);
    },
    dispatch,
  };
  return <SimContext.Provider value={value}>{children}</SimContext.Provider>;
}

export function useSim(): SimContextValue {
  const v = useContext(SimContext);
  if (!v) throw new Error("useSim outside SimProvider");
  return v;
}
