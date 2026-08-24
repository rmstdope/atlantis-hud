/**
 * What the map does with the size it has been measured at.
 *
 * A plain module rather than logic inside `MapCanvas`'s effects, for the reason four beads paid for
 * one at a time (ah-mwqa, ah-brgo.2, ah-t2i, ah-1uj): this package has no jsdom by decision, so its
 * component tests run no effects and see a measured size of `{0,0}` for ever. Every rule that reads
 * the size was therefore smoke-only or untested.
 *
 * The geometry itself already lives in `mapViewport.ts` and `mapViewState.ts` and is reused
 * unchanged. What is here is the *composition* - the size gates, the order the primitives are
 * called in, and whether anything is committed at all - which is the part that was trapped.
 */

import type { Coordinate } from "@atlantis/core-client";
import { parseRegionId } from "../hexMapModel";
import {
  centreOn,
  fitTo,
  ghostShift,
  ghostSpread,
  isOffScreen,
  scaleOf,
  NO_INSETS,
  type Insets,
  type Viewport,
  type WrapSpans
} from "./mapViewport";
import { mapViewDecision, type MapViewState } from "./mapViewState";

/** The measured container. `{0,0}` means not yet measured, and every decision here declines it. */
export type MeasuredSize = { width: number; height: number };

/** The repeats `-spread .. +spread`, in order, as the multiples the ghost copies stand at. */
function repeatsEitherSide(spread: number): number[] {
  return Array.from({ length: spread * 2 + 1 }, (_, index) => index - spread);
}

/**
 * Which copies of the wrapped world exist, given the spans and the measured size.
 *
 * One either side is enough only while the screen is narrower than the world, so how many there are
 * depends on the size - the rule this module exists to make testable.
 */
export function ghostSlots(
  spans: WrapSpans,
  step: number,
  size: MeasuredSize
): { mx: number; my: number }[] {
  if (spans.x === null && spans.y === null) {
    return [];
  }
  const scale = scaleOf(step);
  const xs = spans.x === null ? [0] : repeatsEitherSide(ghostSpread(spans.x, scale, size.width));
  const ys = spans.y === null ? [0] : repeatsEitherSide(ghostSpread(spans.y, scale, size.height));
  return xs.flatMap((mx) => ys.map((my) => ({ mx, my })));
}

/**
 * Where each copy sits for a given camera, and whether it is the original and so not drawn.
 *
 * The slot standing where the world itself is drawn would be a copy on top of the original,
 * doubling every translucent pass.
 */
export function ghostPlacements(
  view: Viewport,
  spans: WrapSpans,
  size: MeasuredSize,
  slots: readonly { mx: number; my: number }[]
): { mx: number; my: number; x: number; y: number; hidden: boolean }[] {
  const scale = scaleOf(view.step);
  const shiftX = ghostShift(view.tx, spans.x, scale, size.width);
  const shiftY = ghostShift(view.ty, spans.y, scale, size.height);
  return slots.map((slot) => {
    const mx = slot.mx + shiftX;
    const my = slot.my + shiftY;
    return {
      mx,
      my,
      x: mx * (spans.x ?? 0),
      y: my * (spans.y ?? 0),
      hidden: mx === 0 && my === 0
    };
  });
}

/**
 * The viewport that brings a newly arrived selection into view, or `null` to leave it alone.
 *
 * `travels` is `travelsToSelection`'s answer, computed by the caller because it compares against a
 * ref the component owns. Everything after it is here: the selection must parse, must be on this
 * level, the container must be measured, and the hex must actually be off screen - a hex clicked on
 * the map is already visible and nothing moves (ah-z31p, moved from `MapCanvas`).
 */
export function followViewport({
  travels,
  selectedRegionId,
  level,
  size,
  view,
  insets
}: {
  travels: boolean;
  selectedRegionId: string | null;
  level: number;
  size: MeasuredSize;
  view: Viewport;
  insets: Insets | null;
}): Viewport | null {
  if (!travels) {
    return null;
  }
  const coordinate = selectedRegionId === null ? null : parseRegionId(selectedRegionId);
  if (!coordinate || coordinate.z !== level || size.width === 0) {
    return null;
  }
  const currentInsets = insets ?? NO_INSETS;
  if (!isOffScreen(coordinate, view, size.width, size.height, currentInsets)) {
    return null;
  }
  return centreOn(coordinate, view, size.width, size.height, currentInsets);
}

/**
 * The viewport the map should frame itself at, or `null` to leave it where it is.
 *
 * Folds together the size gate, `mapViewDecision` and `fitTo` so the effect in `MapCanvas` has no
 * decision left in it. `null` covers four cases the component used to spell out as early returns:
 * nothing measured yet, the store says hold, `fitTo` declined an empty set of hexes, and - the one
 * worth naming - a fit that produced nothing, because *only a view that actually reached the screen
 * counts as framed*: committing anyway would leave the first report to arrive unframed (ah-z31p,
 * moved from `MapCanvas`).
 */
export function framingViewport({
  size,
  view,
  gameId,
  level,
  coordinates,
  insets
}: {
  size: MeasuredSize;
  view: MapViewState;
  /** `null` between games, exactly as `mapViewDecision` accepts it. */
  gameId: string | null;
  level: number;
  coordinates: readonly Coordinate[];
  insets: Insets | null;
}): Viewport | null {
  if (size.width === 0 || size.height === 0) {
    return null;
  }
  const decision = mapViewDecision({
    view,
    gameId,
    level,
    hasHexes: coordinates.length > 0,
    stripKnown: insets !== null
  });

  if (decision.kind === "hold") {
    return null;
  }
  if (decision.kind === "restore") {
    return decision.viewport;
  }
  return fitTo([...coordinates], size.width, size.height, insets ?? NO_INSETS);
}
