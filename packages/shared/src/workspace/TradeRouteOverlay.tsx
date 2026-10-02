import { useEffect, useMemo, useRef } from "react";
import { worldOf } from "./mapViewport";
import { radii } from "./mapThemes/geometry";
import type { TradeArrow } from "./tradeArrow";

/** How far short of each town's centre the track stops, so it never sits on the town mark. */
const END_INSET = radii(0.55);

/* Everything below is in screen pixels: the overlay is sized on screen and placed in the world. */
/** How far apart the two lanes of a two-way route run. */
const LANE_GAP = 5;
/** Coins on the way there and on the way back, how big, and how fast they travel. */
const COINS_THERE = 7;
const COINS_BACK = 5;
const COIN_THERE = 4;
const COIN_BACK = 3;
const SPEED_THERE = 66;
const SPEED_BACK = 48;
/** The rings round each town grow from here to here, once every this many seconds. */
const RING_FROM = 10;
const RING_TO = 38;
const RING_PERIOD = 1.65;
/** The price tags: text size, padding, and how far from the town they sit. */
const TAG_HEIGHT = 18;
const TAG_CHAR = 6.2;
const TAG_PAD = 12;
const TAG_BELOW = 30;
const TAG_ABOVE = -36;

type Lane = { x1: number; y1: number; x2: number; y2: number; length: number };

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
  );
}

function lane(a: { x: number; y: number }, b: { x: number; y: number }, offset: number): Lane {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy) || 1;
  const ux = dx / length;
  const uy = dy / length;
  const nx = -uy * offset;
  const ny = ux * offset;
  const x1 = a.x + ux * END_INSET + nx;
  const y1 = a.y + uy * END_INSET + ny;
  const x2 = b.x - ux * END_INSET + nx;
  const y2 = b.y - uy * END_INSET + ny;
  return { x1, y1, x2, y2, length: Math.hypot(x2 - x1, y2 - y1) };
}

/** Where a coin is `distance` along a lane, and how visible: coins fade in and out at the ends. */
function along(path: Lane, distance: number, fadeLength: number) {
  const t = path.length > 0 ? distance / path.length : 0;
  return {
    x: path.x1 + (path.x2 - path.x1) * t,
    y: path.y1 + (path.y2 - path.y1) * t,
    opacity: Math.max(0, Math.min(1, distance / fadeLength, (path.length - distance) / fadeLength))
  };
}

/**
 * A hovered trade route: silver coins travelling a dotted track from the town where the goods are
 * bought to the one where they sell - and back, in a second lane, when the way back pays too -
 * with rings pulsing round both towns and a tag at each saying what is bought and sold there.
 *
 * Placed in the world and sized on screen: every mark is drawn in pixels under a `1 / scale`
 * transform, because the map zooms out to frame both towns and a mark sized in hexes would shrink
 * to nothing. Moved by writing attributes each frame, as the route comet is. A player whose system
 * asks for less motion gets the same picture, still.
 */
export function TradeRouteOverlay({ arrow, scale }: { arrow: TradeArrow; scale: number }) {
  const from = useMemo(() => worldOf(arrow.from), [arrow.from]);
  const to = useMemo(() => worldOf(arrow.to), [arrow.to]);
  const offset = arrow.twoWay ? LANE_GAP / scale : 0;
  const there = useMemo(() => lane(from, to, offset), [from, to, offset]);
  const back = useMemo(() => lane(to, from, offset), [from, to, offset]);
  const coinsThere = useRef<(SVGGElement | null)[]>([]);
  const coinsBack = useRef<(SVGGElement | null)[]>([]);
  const rings = useRef<(SVGCircleElement | null)[]>([]);
  const reduced = useMemo(prefersReducedMotion, []);

  useEffect(() => {
    const fade = 18 / scale;
    const place = (coins: (SVGGElement | null)[], path: Lane, speed: number, seconds: number) => {
      coins.forEach((coin, index) => {
        if (!coin) {
          return;
        }
        const spacing = (index * path.length) / coins.length;
        const distance = (seconds * (speed / scale) + spacing) % path.length;
        const at = along(path, distance, fade);
        coin.setAttribute("transform", `translate(${at.x},${at.y}) scale(${1 / scale})`);
        coin.setAttribute("opacity", String(at.opacity));
      });
    };
    const draw = (seconds: number) => {
      place(coinsThere.current, there, SPEED_THERE, seconds);
      if (arrow.twoWay) {
        place(coinsBack.current, back, SPEED_BACK, seconds);
      }
      rings.current.forEach((ring, index) => {
        if (!ring) {
          return;
        }
        const phase = (seconds / RING_PERIOD + (index % 2) * 0.5) % 1;
        ring.setAttribute("r", String(RING_FROM + (RING_TO - RING_FROM) * phase));
        ring.setAttribute("opacity", String(1 - phase));
      });
    };
    if (reduced) {
      draw(0.6);
      return;
    }
    const started = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      draw((now - started) / 1000);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [there, back, scale, arrow.twoWay, reduced]);

  const unscale = `scale(${1 / scale})`;
  const headAngle = (Math.atan2(there.y2 - there.y1, there.x2 - there.x1) * 180) / Math.PI;
  const tag = (text: string, accent: string, dy: number, testId: string) => {
    const width = text.length * TAG_CHAR + TAG_PAD * 2;
    return (
      <g transform={`translate(0,${dy})`} data-testid={testId}>
        <rect
          x={-width / 2}
          y={-TAG_HEIGHT / 2}
          width={width}
          height={TAG_HEIGHT}
          rx={TAG_HEIGHT / 2}
          className={`fill-panel ${accent}`}
          fillOpacity={0.92}
          strokeWidth={1.2}
        />
        <text className="trade-tag-text" textAnchor="middle" dominantBaseline="central">
          {text}
        </text>
      </g>
    );
  };

  return (
    <g data-testid="trade-arrow" pointerEvents="none">
      <line x1={there.x1} y1={there.y1} x2={there.x2} y2={there.y2} className="trade-track" />
      {arrow.twoWay && (
        <line x1={back.x1} y1={back.y1} x2={back.x2} y2={back.y2} className="trade-track" />
      )}
      <g transform={`translate(${there.x2},${there.y2}) ${unscale} rotate(${headAngle})`}>
        <path d="M6,0 L-4,-4.5 L-2,0 L-4,4.5 Z" className="fill-trade stroke-ground" strokeWidth={1.2} />
      </g>

      {[from, to].map((town, townIndex) =>
        [0, 1].map((ring) => (
          <circle
            key={`${townIndex}-${ring}`}
            ref={(circle) => {
              rings.current[townIndex * 2 + ring] = circle;
            }}
            cx={0}
            cy={0}
            r={RING_FROM}
            transform={`translate(${town.x},${town.y}) ${unscale}`}
            fill="none"
            className={townIndex === 0 ? "stroke-brass-bright" : "stroke-trade"}
            strokeWidth={2}
            opacity={0}
          />
        ))
      )}

      {Array.from({ length: COINS_THERE }, (_, index) => (
        <g
          key={`there-${index}`}
          ref={(coin) => {
            coinsThere.current[index] = coin;
          }}
          opacity={0}
        >
          <circle r={COIN_THERE} className="fill-trade stroke-ground" strokeWidth={1.2} />
          <circle r={COIN_THERE / 2} fill="none" className="stroke-trade-dim" strokeWidth={0.8} />
        </g>
      ))}
      {arrow.twoWay &&
        Array.from({ length: COINS_BACK }, (_, index) => (
          <g
            key={`back-${index}`}
            ref={(coin) => {
              coinsBack.current[index] = coin;
            }}
            opacity={0}
          >
            <circle r={COIN_BACK} className="fill-trade stroke-ground" strokeWidth={1} />
            <circle r={COIN_BACK / 2} fill="none" className="stroke-trade-dim" strokeWidth={0.7} />
          </g>
        ))}

      <g transform={`translate(${from.x},${from.y}) ${unscale}`}>
        {tag(arrow.fromTag, "stroke-brass-bright", TAG_BELOW, "trade-tag-from")}
      </g>
      <g transform={`translate(${to.x},${to.y}) ${unscale}`}>
        {tag(arrow.toTag, "stroke-trade", TAG_ABOVE, "trade-tag-to")}
      </g>
    </g>
  );
}
