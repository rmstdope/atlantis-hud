import type { Coordinate, TradeRoute, TradedGood } from "@atlantis/core-client";
import { regionIdOf } from "../hexMapModel";
import { POPOVER_BODY_MAX_H } from "./primitives";
import { PopoverFrame } from "./popover";

/** `36,4`, or `2:7,53` when the two hexes of a row are not on the same level (see `writeHex`). */
function writeHex(coordinate: Coordinate, sameLevelAs: Coordinate): string {
  if (coordinate.z === sameLevelAs.z) {
    return `${coordinate.x},${coordinate.y}`;
  }
  return `${coordinate.z}:${coordinate.x},${coordinate.y}`;
}

/** `chocolate CHOC · 41 × +$249`, optionally prefixed `out: ` / `back: ` for a circuit's two legs. */
function goodLine(good: TradedGood, prefix: string): string {
  return `${prefix}${good.name} ${good.tag} · ${good.quantity.toLocaleString()} × +$${good.margin.toLocaleString()}`;
}

/** `14/7/4 turns on foot/riding/flying`, an em dash per mode that cannot make it, or, when none
 * can, `no known way` in place of the whole line. */
function journeyLine(turns: TradeRoute["turns"]): string {
  if (turns.walk === null && turns.ride === null && turns.fly === null) {
    return "no known way";
  }
  const mode = (value: number | null) => (value === null ? "—" : String(value));
  return `${mode(turns.walk)}/${mode(turns.ride)}/${mode(turns.fly)} turns on foot/riding/flying`;
}

/**
 * When a half of a route's price is older than the other, so the row can say which one.
 *
 * Neither `TradeRoute` nor `TradePanel` is told the current turn number, so staleness is judged
 * relative to the route's own two halves rather than against an outside clock: across every good
 * in the route, whichever of `buySeenTurn`/`sellSeenTurn` sits behind the freshest turn seen
 * anywhere in the row is the "stale half" this reports. A route entirely from one turn (the usual
 * case) has nothing older than itself and reports nothing. Not specified by the plan; recorded as
 * a deviation in the PR body.
 */
function staleNote(goods: TradedGood[]): string | null {
  const buyTurns = goods.map((good) => good.buySeenTurn).filter((turn): turn is number => turn !== null);
  const sellTurns = goods.map((good) => good.sellSeenTurn).filter((turn): turn is number => turn !== null);
  const freshest = Math.max(...buyTurns, ...sellTurns, -Infinity);
  if (freshest === -Infinity) {
    return null;
  }
  const staleBuy = buyTurns.length > 0 ? Math.min(...buyTurns) : null;
  const staleSell = sellTurns.length > 0 ? Math.min(...sellTurns) : null;
  const parts: string[] = [];
  if (staleBuy !== null && staleBuy < freshest) {
    parts.push(`buy price seen turn ${staleBuy}`);
  }
  if (staleSell !== null && staleSell < freshest) {
    parts.push(`sell price seen turn ${staleSell}`);
  }
  return parts.length > 0 ? parts.join(", ") : null;
}

/**
 * Every trade worth making in the map the faction has seen, in a popover under the header's Trade
 * chip - the shape `ProblemsPanel` already has, and the reasoning is the same
 * (`ProblemsPanel.tsx:5-16`): the region panel answers "what is here", this answers what is worth
 * doing somewhere you have not looked. Each row is a button, as `ProblemsPanel`'s hexes are.
 */
export function TradePanel({
  routes,
  labelFor,
  onSelectHex,
  onDismiss
}: {
  routes: TradeRoute[];
  /** How a hex reads in the interface, for instance `mountain (7,53)`. */
  labelFor: (regionId: string) => string;
  onSelectHex: (regionId: string) => void;
  onDismiss: () => void;
}) {
  return (
    <PopoverFrame testId="trade-panel" label="Trade routes" align="left" width="w-96">
      <div className="flex items-center gap-2 border-b border-edge px-2 py-1.5">
        <span className="text-ink-soft">
          {routes.length} route{routes.length === 1 ? "" : "s"}
        </span>
        <span className="flex-1" />
        <button
          type="button"
          aria-label="close trade routes"
          onClick={onDismiss}
          className="rounded px-1.5 text-ink-dim hover:text-ink"
        >
          ✕
        </button>
      </div>

      {routes.length === 0 ? (
        <p className="px-2 py-3 text-ink-dim">
          Nothing to trade yet. No hex you have seen sells a good that another will pay more for.
        </p>
      ) : (
        <ul className={`${POPOVER_BODY_MAX_H} list-none overflow-y-auto p-2`}>
          {routes.map((route, index) => {
            const circuit = route.inbound.length > 0;
            const stale = staleNote([...route.outbound, ...route.inbound]);
            return (
              <li
                key={`${regionIdOf(route.from)}-${regionIdOf(route.to)}`}
                className="border-t border-edge-soft py-1 first:border-t-0"
              >
                <button
                  type="button"
                  data-testid={`trade-route-${index}`}
                  title={`${labelFor(regionIdOf(route.from))} ${circuit ? "⇄" : "→"} ${labelFor(regionIdOf(route.to))}`}
                  onClick={() => {
                    onSelectHex(regionIdOf(route.from));
                    onDismiss();
                  }}
                  className="w-full rounded px-1 text-left hover:bg-panel"
                >
                  <div className="flex items-baseline gap-2">
                    <span className="text-brass">
                      {writeHex(route.from, route.to)} {circuit ? "⇄" : "→"} {writeHex(route.to, route.from)}
                    </span>
                    <span className="flex-1" />
                    <span className="text-gain">${route.worth.toLocaleString()}</span>
                  </div>
                  {route.outbound.map((good, goodIndex) => (
                    <div key={`out-${goodIndex}`} className="text-ink-soft">
                      {goodLine(good, circuit ? "out: " : "")}
                    </div>
                  ))}
                  {route.inbound.map((good, goodIndex) => (
                    <div key={`in-${goodIndex}`} className="text-ink-soft">
                      {goodLine(good, "back: ")}
                    </div>
                  ))}
                  <div className="text-ink-dim">
                    {journeyLine(route.turns)}
                    {stale ? <span className="text-warn"> · {stale}</span> : null}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <p className="border-t border-edge px-2 py-1.5 text-ink-dim">
        Prices are as last seen, and the journeys assume an unladen unit through hexes you have
        explored.
      </p>
    </PopoverFrame>
  );
}
