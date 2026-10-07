import { useEffect, useRef, useState } from "react";
import { APP_VERSION } from "../appVersion";
import { clearTimings, stepSummaries, summariseFrames, type FrameSummary, type StepSummary } from "../perf";
import { useSettingsStore } from "../settingsStore";

/** How much frame history the rate is worked out over, and how often the panel refreshes. */
const FRAME_WINDOW_MS = 3000;
const REFRESH_MS = 500;

type MapCensus = { hexes: number; elements: number; copies: number };

/** What the map has in it right now: read from the page, so it counts what is actually drawn. */
function mapCensus(): MapCensus | null {
  const world = document.getElementById("map-world-content");
  if (!world) {
    return null;
  }
  const copies = [...document.querySelectorAll('[data-testid="map-world-ghost"]')].filter(
    (copy) => copy.getAttribute("display") !== "none" && getComputedStyle(copy).display !== "none"
  ).length;
  return {
    hexes: document.querySelectorAll("[data-region-id]").length,
    elements: world.querySelectorAll("*").length,
    copies
  };
}

const ms = (value: number) => `${value < 10 ? value.toFixed(1) : Math.round(value)} ms`;

type Machine = { cores: string; memory: string; screen: string; agent: string };

function machine(): Machine {
  const nav = navigator as Navigator & { deviceMemory?: number };
  return {
    cores: String(nav.hardwareConcurrency ?? "?"),
    memory: nav.deviceMemory ? `${nav.deviceMemory} GB` : "not reported",
    screen: `${window.innerWidth}×${window.innerHeight} at ${window.devicePixelRatio}x`,
    agent: nav.userAgent
  };
}

/**
 * The performance panel: how smoothly the app is drawing, how long its heavy steps took, how big
 * the map is, and what machine it is running on - with a button that copies all of it as plain
 * text, so a player on a slow machine can paste real figures into a report.
 *
 * Frames are counted only while the panel is open: the count is itself a little work on every
 * frame, and it is measuring the app, not adding to it the rest of the time.
 */
export function PerformancePanel({ platformLabel }: { platformLabel: string }) {
  // One selector each: a selector returning a fresh object would make every store read look like a
  // change, and re-render the panel without end.
  const settings = {
    mapTheme: useSettingsStore((state) => state.mapTheme),
    biomeTextures: useSettingsStore((state) => state.biomeTextures),
    waterAnimation: useSettingsStore((state) => state.waterAnimation),
    animateMapTheme: useSettingsStore((state) => state.animateMapTheme),
    animateMovement: useSettingsStore((state) => state.animateMovement)
  };
  const stamps = useRef<number[]>([]);
  const [frames, setFrames] = useState<FrameSummary | null>(null);
  const [steps, setSteps] = useState<StepSummary[]>([]);
  const [census, setCensus] = useState<MapCensus | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let frame = 0;
    const tick = (stamp: number) => {
      const list = stamps.current;
      list.push(stamp);
      while (list.length > 2 && stamp - list[0] > FRAME_WINDOW_MS) {
        list.shift();
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    const refresh = window.setInterval(() => {
      setFrames(summariseFrames(stamps.current));
      setSteps(stepSummaries());
      setCensus(mapCensus());
    }, REFRESH_MS);
    return () => {
      cancelAnimationFrame(frame);
      window.clearInterval(refresh);
    };
  }, []);

  const report = () => {
    const box = machine();
    const lines = [
      `Atlantis HUD ${APP_VERSION} (${platformLabel})`,
      frames
        ? `Frames: ${frames.fps.toFixed(1)}/s, typical ${ms(frames.median)}, slow ${ms(frames.p95)}, worst ${ms(frames.worst)}, ${frames.slow} over 50 ms`
        : "Frames: not measured yet",
      census
        ? `Map: ${census.hexes} hexes, ${census.elements} elements, ${census.copies} wrap copies`
        : "Map: none open",
      ...steps.map(
        (step) => `${step.step}: last ${ms(step.last)}, median ${ms(step.median)}, worst ${ms(step.worst)} (${step.count} runs)`
      ),
      `Settings: theme ${settings.mapTheme}, textures ${settings.biomeTextures ? "on" : "off"}, water ${settings.waterAnimation}, theme animation ${settings.animateMapTheme ? "on" : "off"}, route animation ${settings.animateMovement ? "on" : "off"}`,
      `Machine: ${box.cores} cores, memory ${box.memory}, screen ${box.screen}`,
      `Browser: ${box.agent}`
    ];
    return lines.join("\n");
  };

  const copy = async () => {
    const text = report();
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // A shell without the async clipboard: the old way, through a selected textarea.
      const area = document.createElement("textarea");
      area.value = text;
      document.body.append(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <section
      data-testid="performance-panel"
      aria-label="Performance"
      className="fixed bottom-3 left-3 z-40 w-80 rounded border border-edge bg-panel px-2.5 py-2 text-pane-sm text-ink-soft shadow-lg"
    >
      <header className="mb-1 flex items-center justify-between gap-2">
        <strong className="text-brass">Performance</strong>
        <span className="flex gap-1.5">
          <button
            type="button"
            data-testid="performance-reset"
            onClick={() => {
              clearTimings();
              stamps.current = [];
            }}
            className="rounded border border-edge px-1.5 hover:border-brass"
          >
            Reset
          </button>
          <button
            type="button"
            data-testid="performance-copy"
            onClick={() => void copy()}
            className="rounded border border-edge px-1.5 text-brass hover:border-brass"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </span>
      </header>
      <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
        <dt>Frames</dt>
        <dd data-testid="performance-frames" className="text-ink">
          {frames
            ? `${frames.fps.toFixed(1)}/s · ${ms(frames.median)} · slow ${ms(frames.p95)} · ${frames.slow} stutters`
            : "measuring…"}
        </dd>
        <dt>Map</dt>
        <dd data-testid="performance-map" className="text-ink">
          {census ? `${census.hexes} hexes · ${census.elements} elements · ${census.copies} copies` : "none open"}
        </dd>
        {steps.map((step) => (
          <div key={step.step} className="contents">
            <dt>{step.step}</dt>
            <dd className="text-ink" data-step={step.step}>
              {ms(step.last)} <span className="text-ink-dim">(median {ms(step.median)}, worst {ms(step.worst)})</span>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
