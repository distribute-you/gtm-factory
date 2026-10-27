"use client";

/**
 * The simulator, held once for the whole app: the world, the session, the day, the play controls,
 * and every action a visitor took (logged with its day, so a reload replays the same history).
 * Pages read one `Model` per simulated day.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { SimulationSession, WorldSpec } from "@gtm-factory/core";
import { buildModel, type Model } from "./model";
import { SCENARIOS, applyAction, replay, scenarioData, type LoggedAction, type ScenarioId, type SimAction } from "./world";
import { DEFAULT_PINS, readPins, writePins, type Pin } from "./pins";

const STORAGE_KEY = "gtm-factory:v2";
export const SPEEDS = [1, 2, 4, 8] as const;
export type Speed = (typeof SPEEDS)[number];
/** The day the dashboard opens on for a first visit: enough history to read every page. */
export const FIRST_VISIT_DAY = 30;

interface Saved {
  scenario?: ScenarioId;
  seed: number;
  day: number;
  actions: LoggedAction[];
  scope: string | null;
}

interface SimContextValue {
  model: Model | null;
  seed: number;
  scenario: ScenarioId;
  /** Start another scenario (from day 0 of its own seed). */
  setScenario: (id: ScenarioId) => void;
  /** Menu entries pinned to the sidebar (configuration, kept in this browser). */
  pins: Pin[];
  setPins: (pins: Pin[]) => void;
  playing: boolean;
  speed: Speed;
  scope: string | null;
  actions: LoggedAction[];
  setScope: (brandId: string | null) => void;
  play: () => void;
  pause: () => void;
  stepDay: () => void;
  setSpeed: (s: Speed) => void;
  reset: (seed: number) => void;
  dispatch: (action: SimAction) => string | null;
}

const SimContext = createContext<SimContextValue | null>(null);

function readSaved(): Saved | null {
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.has("day") || params.has("seed")) {
      return {
        scenario: (params.get("scenario") as ScenarioId | null) ?? "fictional",
        seed: Number(params.get("seed") ?? scenarioData((params.get("scenario") as ScenarioId | null) ?? "fictional").seed) || scenarioData("fictional").seed,
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
  const [seed, setSeed] = useState<number>(scenarioData("fictional").seed);
  const [scenario, setScenarioState] = useState<ScenarioId>("fictional");
  const [pins, setPinsState] = useState<Pin[]>(DEFAULT_PINS);
  const [actions, setActions] = useState<LoggedAction[]>([]);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<Speed>(2);
  const [scope, setScope] = useState<string | null>(null);

  const load = useCallback((sd: number, acts: LoggedAction[], day: number, sc: ScenarioId = "fictional") => {
    const { world, session, applied } = replay(sd, acts, day, SCENARIOS[sc] ? sc : "fictional");
    setScenarioState(SCENARIOS[sc] ? sc : "fictional");
    worldRef.current = world;
    sessionRef.current = session;
    setSeed(sd);
    setActions(applied);
    setVersion((v) => v + 1);
  }, []);

  // First load: the saved history (or the URL's), else a first visit opened on day 30.
  useEffect(() => {
    setPinsState(readPins());
    const saved = readSaved();
    if (saved) {
      setScope(saved.scope);
      load(saved.seed, saved.actions, saved.day, saved.scenario ?? "fictional");
    } else load(scenarioData("fictional").seed, [], FIRST_VISIT_DAY);
  }, [load]);

  const model = useMemo(() => {
    void version;
    return worldRef.current && sessionRef.current ? buildModel(worldRef.current, sessionRef.current) : null;
  }, [version]);

  // Keep the history so a reload lands on the same day.
  useEffect(() => {
    if (!model) return;
    const saved: Saved = { scenario, seed, day: model.day, actions, scope };
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
    seed,
    scenario,
    setScenario: (id) => {
      setPlaying(false);
      setScope(null);
      load(scenarioData(id).seed, [], FIRST_VISIT_DAY, id);
    },
    pins,
    setPins: (p) => {
      setPinsState(p);
      writePins(p);
    },
    playing,
    speed,
    scope,
    actions,
    setScope,
    play: () => setPlaying(true),
    pause: () => setPlaying(false),
    stepDay,
    setSpeed,
    reset: (sd) => {
      setPlaying(false);
      setScope(null);
      load(sd, [], 0, scenario);
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
