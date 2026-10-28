"use client";

import { useEffect, useState } from "react";
import { ArrowCounterClockwiseIcon, DiceFiveIcon, PauseIcon, PlayIcon, SkipForwardIcon } from "@phosphor-icons/react";
import { useSim, SPEEDS, type Speed } from "@/lib/sim";

/** The simulator, always in reach above every page in the demo: the day, run / pause / one day / speed, reset on a seed. */
export function SimulatorBar() {
  const { model, playing, run, pause, stepDay, speed, setSpeed, reset, seed } = useSim();
  const [seedText, setSeedText] = useState(String(seed));
  useEffect(() => setSeedText(String(seed)), [seed]);
  const nextSpeed = (): Speed => SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]!;
  return (
    <div className="flex h-12 shrink-0 items-center gap-2 overflow-x-auto px-2 lg:pl-0" role="toolbar" aria-label="Simulator">
      <span className="k-label hidden shrink-0 pl-1 sm:inline">Simulator</span>
      <span className="flex shrink-0 items-center gap-1.5 pl-1 pr-1">
        {playing ? <span className="k-dot-pulse h-1.5 w-1.5 rounded-full bg-[var(--run)] text-[var(--run)]" /> : <span className="h-2 w-2 rounded-full border-[1.5px] border-[var(--fg-3)]" />}
        <span className="text-[15px] font-medium tabular-nums" data-testid="sim-day">
          Day {model ? model.day : "—"}
        </span>
      </span>
      <button type="button" onClick={playing ? pause : run} className="k-btn-strong shrink-0" aria-label={playing ? "Pause" : "Run"}>
        {playing ? <PauseIcon size={13} weight="fill" /> : <PlayIcon size={13} weight="fill" />}
        {playing ? "Pause" : "Run"}
      </button>
      <button type="button" onClick={stepDay} className="k-btn shrink-0" title="Run one more day">
        <SkipForwardIcon size={13} />
        One day
      </button>
      <button type="button" onClick={() => setSpeed(nextSpeed())} className="k-btn shrink-0 tabular-nums" title="Days per second" aria-label={`Speed: ${speed} days per second`}>
        {speed} days/s
      </button>
      <span className="mx-1 h-5 w-px shrink-0 bg-[var(--line)]" aria-hidden="true" />
      <span className="k-input flex w-[104px] shrink-0 items-center gap-1 px-2">
        <span className="k-fg3 text-[12px]">Seed</span>
        <input
          aria-label="Seed"
          value={seedText}
          onChange={(e) => setSeedText(e.target.value.replace(/[^0-9]/g, "").slice(0, 6))}
          className="w-full min-w-0 bg-transparent tabular-nums outline-none"
          style={{ font: "inherit" }}
        />
      </span>
      <button type="button" className="k-btn shrink-0" title="Random seed" aria-label="Random seed" onClick={() => setSeedText(String(1 + Math.floor(Math.random() * 99_999)))}>
        <DiceFiveIcon size={13} />
      </button>
      <button type="button" className="k-btn shrink-0" title="Start the world again from day 0 on this seed" onClick={() => reset(Number(seedText) || 1)}>
        <ArrowCounterClockwiseIcon size={13} />
        Reset
      </button>
    </div>
  );
}
