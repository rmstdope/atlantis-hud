import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Coordinate, HexRisk } from "@atlantis/core-client";
import { parseRegionId, regionIdOf, type HexMapModel, type HexNode } from "../hexMapModel";
import {
  accumulateWheel,
  centreOn,
  coordinateAt,
  fitTo,
  HEX_RADIUS,
  isOffScreen,
  neighbour,
  rulerTicks,
  scaleOf,
  transformString,
  wheelPixels,
  worldOf,
  zoomAt,
  zoomBand,
  NO_INSETS,
  type ArrowKey,
  type Insets,
  type Viewport
} from "./mapViewport";
import { rectFromCorners, rectPixels, type MapRect } from "./mapMarquee";
import { overlayInsets, type OverlayBox } from "./mapOverlayInsets";
import { loadSavedView, saveViewportForGame, type SavedMapView } from "./mapViewportStorage";
import { keepsRestoredHex, mapViewDecision, shouldFollowSelection } from "./mapViewRestore";
import type { RouteOverlay } from "./routeOverlay";
import { guardSelection } from "./selectionGuard";
import {
  fogPatternTile,
  hexPointsAttribute,
  routeSegments,
  terrainTexturePatternId,
  terrainTextureUrl
} from "./mapHexView";
import { buildHexViews, type BadgeName } from "./mapThemes/hexView";
import type { MapTheme } from "./mapThemes/mapTheme";

const HEX_POINTS = hexPointsAttribute(HEX_RADIUS);
const FOG_TILE = fogPatternTile(HEX_RADIUS);
const ORIGIN: Viewport = { tx: 0, ty: 0, step: 0 };

/** How far the pointer may travel before a press stops counting as a click on a hex. */
const DRAG_SLOP = 4;

/** Room a coordinate label needs before its neighbour has to be dropped. */
const COLUMN_LABEL_ROOM = 44;
const ROW_LABEL_ROOM = 16;

const ARROWS: ArrowKey[] = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
const TEXTURED_TERRAIN_NAMES = [
  "ocean",
  "plain",
  "forest",
  "mountain",
  "swamp",
  "jungle",
  "desert",
  "tundra",
  "volcano",
  "cavern",
  "underforest",
  "wasteland"
] as const;

/** Identifies a position on the lattice, whether or not a hex is known to be there. */
function cursorKeyOf(coordinate: Coordinate): string {
  return `${coordinate.x},${coordinate.y}`;
}

function hexAt(hexes: HexNode[], coordinate: Coordinate): HexNode | null {
  return (
    hexes.find(
      (hex) => hex.coordinate.x === coordinate.x && hex.coordinate.y === coordinate.y
    ) ?? null
  );
}

const RISK_CLASSES: Record<string, string> = {
  low: "fill-risk-low stroke-risk-low",
  medium: "fill-risk-medium stroke-risk-medium",
  high: "fill-risk-high stroke-risk-high"
};

type MapCanvasProps = {
  /** The open game's identifier, used to save and restore the map position across sessions. */
  gameId: string | null;
  model: HexMapModel;
  /**
   * How to draw a hex. Everything theme-specific lives behind this: the map itself knows about
   * geometry, interaction and the route overlay, and nothing about parchment or bevels.
   */
  theme: MapTheme;
  level: number;
  selectedRegionId: string | null;
  onSelectRegion: (regionId: string) => void;
  showStaleness: boolean;
  showTextures: boolean;
  /** Which marks the themes may draw over the terrain, one flag per kind. */
  badges: Record<BadgeName, boolean>;
  /**
   * The movement line to draw, whatever its source - the planner's preview or a written order.
   * Solid through the hexes the coming month covers, dotted for the rest; a null `solidSteps`
   * means the unit's speed is unknown and the whole line is dotted.
   */
  route?: RouteOverlay | null;
  /** How dangerous each hex entered is, so one bad step is visible rather than buried. */
  routeRisk?: HexRisk[];
  /**
   * Where a Shift+drag finished, as a rectangle of hexes. Absent when nothing on screen wants one,
   * which is also what stands the gesture down.
   */
  onMarquee?: (rect: MapRect) => void;
};

/**
 * The world map.
 *
 * Drawn in SVG rather than into a canvas, which is what makes the rest of it possible: the browser
 * re-rasterises every glyph at device resolution on every paint, so a settlement name is as sharp
 * at maximum zoom as at minimum. The canvas renderer baked each label into a texture once, at nine
 * pixels, and then magnified it up to threefold.
 *
 * Three things are worth knowing before changing it:
 *
 * - **The unexplored lattice is one rectangle.** It used to be a loop over every position in the
 *   bounding box, which grew with the map. As a `<pattern>` it costs the same whatever the faction
 *   has explored, and it is what makes drawing every known hex affordable.
 * - **Panning writes no React state.** The view transform lives in a ref and is written straight to
 *   one group; `transform` is deliberately absent from the JSX, because React only touches an
 *   attribute it has a previous value for. A drag therefore costs no reconciliation at all.
 * - **The hexes are the accessible layer.** There is no longer a parallel set of off-screen
 *   buttons: each hex is itself a button, focusable and labelled, with the roving tabindex a grid
 *   is supposed to have so the map is one tab stop rather than several thousand.
 */
export function MapCanvas({
  gameId,
  model,
  theme,
  level,
  selectedRegionId,
  onSelectRegion,
  showStaleness,
  showTextures,
  badges,
  route = null,
  routeRisk = [],
  onMarquee
}: MapCanvasProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<SVGSVGElement | null>(null);
  const worldRef = useRef<SVGGElement | null>(null);
  const fogRef = useRef<SVGPatternElement | null>(null);
  const rulerXRef = useRef<SVGGElement | null>(null);
  const rulerYRef = useRef<SVGGElement | null>(null);
  const marqueeRef = useRef<SVGRectElement | null>(null);

  const viewRef = useRef<Viewport>(ORIGIN);
  const carryRef = useRef(0);
  const draggedRef = useRef(false);
  const pendingFocusRef = useRef<string | null>(null);
  // Which level of which game the view was last framed for.
  //
  // Keyed on the game rather than on the model, because a new model is not a new place to stand: a
  // turn imported into the open game used to re-frame the whole level and throw away a position the
  // player had just chosen. Only ever stamped when a view was actually committed, so a game whose
  // first frame ran against an empty model still gets framed when its report arrives.
  const framedRef = useRef<{ gameId: string | null; level: number | null }>({
    gameId: null,
    level: null
  });

  const [view, setView] = useState<Viewport>(ORIGIN);
  const [size, setSize] = useState({ width: 0, height: 0 });
  // Where the keyboard is, as a coordinate rather than a hex: the cursor is allowed to stand on
  // ground nobody has visited, which is what makes crossing between known islands possible.
  const [cursor, setCursor] = useState<Coordinate | null>(null);
  const [mapFocused, setMapFocused] = useState(false);

  const selectRef = useRef(onSelectRegion);
  selectRef.current = onSelectRegion;

  // Kept in a ref so that the commit callback can read the current gameId without being
  // re-created whenever the game changes.
  const gameIdRef = useRef<string | null>(gameId);
  gameIdRef.current = gameId;

  // Holds the view that should be applied the next time the frame effect runs. Set when the game
  // changes and the player has a saved one for it; cleared once the position is applied.
  const pendingRestoreRef = useRef<SavedMapView | null>(null);
  // The hex a restore put back, for as long as it is still the one selected. The map does not
  // travel to this one: the saved position is where the player left the map, and a player who
  // panned away from their own selection before quitting meant to.
  const restoredRegionRef = useRef<string | null>(null);

  const onLevel = useMemo(
    () => model.hexes.filter((hex) => hex.coordinate.z === level),
    [model, level]
  );

  /**
   * What each hex shows, worked out once for whichever theme is drawing.
   *
   * The badge toggles are applied here rather than passed on, so a theme draws exactly what the
   * view model says and cannot forget to honour a toggle - there is nothing left to forget. This
   * memo is also the whole of the redraw: turning a badge off rebuilds the views and React does
   * the rest.
   */
  const viewOptions = useMemo(
    () => ({ showStaleness, showTextures, badges }),
    [showStaleness, showTextures, badges]
  );
  const allViews = useMemo(() => buildHexViews(onLevel, viewOptions), [onLevel, viewOptions]);
  // The knowledge buckets are cut from that one pass rather than built again from `hexLayers`:
  // every view carries its own knowledge, and building them twice meant two structure tallies and
  // two unit scans for every hex on screen. Model order is preserved either way.
  const buckets = useMemo(
    () => ({
      named: allViews.filter((view) => view.knowledge === "named"),
      stale: allViews.filter((view) => view.knowledge === "stale"),
      current: allViews.filter((view) => view.knowledge === "current")
    }),
    [allViews]
  );

  /**
   * Pushes the current view into the DOM.
   *
   * Called after every commit rather than only when the view changes, so a re-render that
   * remounted the group cannot leave the map sitting at the origin.
   */
  const applyView = useCallback(() => {
    const current = viewRef.current;
    const transform = transformString(current);
    worldRef.current?.setAttribute("transform", transform);
    fogRef.current?.setAttribute("patternTransform", transform);
    rulerXRef.current?.setAttribute("transform", `translate(${current.tx.toFixed(2)},0)`);
    rulerYRef.current?.setAttribute("transform", `translate(0,${current.ty.toFixed(2)})`);
    rootRef.current?.style.setProperty("--map-scale", scaleOf(current.step).toFixed(4));
  }, []);

  useLayoutEffect(() => {
    applyView();
    if (pendingFocusRef.current) {
      // Keyed on the lattice position rather than a region id, because the cursor can be standing
      // on ground that has no region.
      const target = rootRef.current?.querySelector<SVGPolygonElement>(
        `[data-cursor="${pendingFocusRef.current}"]`
      );
      pendingFocusRef.current = null;
      target?.focus();
    }
  });

  /** Moves the view and re-renders anything that reads it, such as the rulers. */
  const commit = useCallback(
    (next: Viewport) => {
      viewRef.current = next;
      applyView();
      setView(next);
      const id = gameIdRef.current;
      if (id) {
        saveViewportForGame(id, next);
      }
    },
    [applyView]
  );

  /** Moves the view without re-rendering, which is what keeps a drag free. */
  const slide = useCallback(
    (next: Viewport) => {
      viewRef.current = next;
      applyView();
    },
    [applyView]
  );

  /**
   * How much of the map the panes are covering right now.
   *
   * Read from the DOM at the moment it is needed rather than held in state: a pane folds, a dock
   * grows, and a fit that used a remembered measurement would frame into a strip that has since
   * moved. Nothing here knows which panes exist - a pane says so by marking itself.
   */
  const readInsets = useCallback((): Insets => {
    const host = hostRef.current;
    const container = host?.parentElement;
    if (!host || !container) {
      return NO_INSETS;
    }
    const overlays: OverlayBox[] = Array.from(
      container.querySelectorAll<HTMLElement>("[data-map-overlay]")
    ).map((element) => ({
      // Handed over as the attribute reads. Whether it names an edge is `overlayInsets`'s
      // question, and asserting it into the union here would only hide a typo from the answer.
      edge: element.dataset.mapOverlay,
      box: element.getBoundingClientRect()
    }));
    return overlayInsets(host.getBoundingClientRect(), overlays);
  }, []);

  // The canvas renderer got its size from Pixi's `resizeTo`. Rulers and framing need it too.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return undefined;
    }
    const observer = new ResizeObserver(() => {
      const width = Math.round(host.clientWidth);
      const height = Math.round(host.clientHeight);
      setSize((previous) =>
        previous.width === width && previous.height === height ? previous : { width, height }
      );
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  // Loads the saved view when the game changes so it is ready for the frame effect below.
  // This effect runs before the frame effect (effects fire in definition order), which is what
  // makes the restore win over the default fit when both happen in the same render cycle.
  useEffect(() => {
    const saved = gameId === null ? null : loadSavedView(gameId);
    pendingRestoreRef.current = saved;
    // Remembered separately from the pending view, because it has to outlive it: the view is
    // consumed by the first frame, while the hex it belongs to has to stay exempt from the
    // selection-follow below for as long as it is the one selected.
    restoredRegionRef.current = saved?.regionId ?? null;
    framedRef.current = { gameId: null, level: null };
  }, [gameId]);

  // Frames the world when there is a view to put on screen and none already standing. Another
  // level's hexes can sit somewhere completely different, so arriving on one nobody has framed
  // opens on empty fog unless it is fitted.
  useEffect(() => {
    if (size.width === 0 || size.height === 0) {
      return;
    }
    const framed = framedRef.current;
    const decision = mapViewDecision({
      pending: pendingRestoreRef.current,
      level,
      framedLevel: framed.gameId === gameId ? framed.level : null,
      hasHexes: onLevel.length > 0
    });

    if (decision.kind === "hold") {
      return;
    }

    if (decision.kind === "restore") {
      pendingRestoreRef.current = null;
      framedRef.current = { gameId, level };
      commit(decision.viewport);
      return;
    }

    const fitted = fitTo(
      onLevel.map((hex) => hex.coordinate),
      size.width,
      size.height,
      readInsets()
    );
    // Only a view that actually reached the screen counts as framed. `fitTo` declines an empty
    // set, and stamping the frame anyway would leave the first report to arrive unframed.
    if (fitted) {
      framedRef.current = { gameId, level };
      commit(fitted);
    }
  }, [gameId, level, onLevel, size, commit, readInsets]);

  // Brings the selection into view when it arrives from somewhere other than the map — the units
  // table, or a restored session. A hex clicked on the map is already visible, so nothing moves.
  //
  // Read from the id rather than looked up among the hexes, so unexplored ground is brought into
  // view too: it carries the selection ring and the keyboard cursor like any other hex, and one of
  // those off screen is a ring nobody can see and a tab stop nobody can find.
  useEffect(() => {
    const follow = shouldFollowSelection(selectedRegionId, restoredRegionRef.current);
    // Past the restored hex the moment the selection is anything else - another hex, or nothing at
    // all, which is what changing level leaves behind. Forgetting it here is what lets the map
    // travel to that same hex later, when the player picks it from the units table rather than
    // being handed it back by a restore.
    if (!keepsRestoredHex(selectedRegionId, restoredRegionRef.current)) {
      restoredRegionRef.current = null;
    }
    if (!follow) {
      return;
    }

    const coordinate = selectedRegionId === null ? null : parseRegionId(selectedRegionId);
    if (!coordinate || coordinate.z !== level || size.width === 0) {
      return;
    }
    const insets = readInsets();
    if (isOffScreen(coordinate, viewRef.current, size.width, size.height, insets)) {
      commit(centreOn(coordinate, viewRef.current, size.width, size.height, insets));
    }
  }, [selectedRegionId, level, size, commit, readInsets]);

  // React attaches `wheel` passively, so `preventDefault` inside an `onWheel` prop does nothing and
  // the page zooms instead of the map. This has to be a manual listener.
  useEffect(() => {
    const root = rootRef.current;
    const host = hostRef.current;
    if (!root || !host) {
      return undefined;
    }
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const pixels = wheelPixels(event.deltaY, event.deltaMode, host.clientHeight);
      const { steps, carry } = accumulateWheel(carryRef.current, pixels);
      carryRef.current = carry;
      if (steps === 0) {
        return;
      }
      const bounds = root.getBoundingClientRect();
      // Wheel down is positive and means zoom out.
      commit(
        zoomAt(viewRef.current, -steps, event.clientX - bounds.left, event.clientY - bounds.top)
      );
    };
    root.addEventListener("wheel", onWheel, { passive: false });
    return () => root.removeEventListener("wheel", onWheel);
  }, [commit]);

  /**
   * Drags out the export rectangle, hung on Shift so the plain drag stays a pan.
   *
   * The band is written straight onto its own element for the same reason the view transform is:
   * a rectangle that re-rendered the map on every pointer move would drag as badly as panning did
   * before the transform moved into a ref.
   */
  const startMarquee = (event: React.PointerEvent<SVGSVGElement>) => {
    const root = rootRef.current;
    const band = marqueeRef.current;
    if (!root || !band || !onMarquee) {
      return false;
    }

    // The gesture is a selection of ground, not of a hex: without this the pointerup would fall
    // through to the hex or the fog underneath and change what is selected.
    draggedRef.current = true;
    const bounds = root.getBoundingClientRect();
    const hexAtPointer = (clientX: number, clientY: number) =>
      coordinateAt(clientX - bounds.left, clientY - bounds.top, viewRef.current, level);

    const from = hexAtPointer(event.clientX, event.clientY);
    let rect = rectFromCorners(from, from);
    const paint = () => {
      const box = rectPixels(rect);
      band.setAttribute("x", String(box.x));
      band.setAttribute("y", String(box.y));
      band.setAttribute("width", String(box.width));
      band.setAttribute("height", String(box.height));
      band.removeAttribute("visibility");
    };
    paint();

    const releaseSelection = guardSelection();
    const move = (moved: PointerEvent) => {
      rect = rectFromCorners(from, hexAtPointer(moved.clientX, moved.clientY));
      paint();
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      releaseSelection();
      band.setAttribute("visibility", "hidden");
      onMarquee(rect);
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return true;
  };

  const onPointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) {
      return;
    }
    if (event.shiftKey && startMarquee(event)) {
      return;
    }
    draggedRef.current = false;
    const start = { x: event.clientX, y: event.clientY };
    const origin = viewRef.current;
    // Deliberately no `setPointerCapture`. Capturing the pointer on the root retargets the click
    // to the capturing element, so no hex would ever receive one and the map would pan and zoom
    // but refuse to select. The window listeners below already carry a drag outside the element,
    // which is the only thing capture would have bought.

    // A pan is a hand on the map, not a selection gesture, but the browser cannot tell: WebKit -
    // the engine the desktop shell runs in - anchors a native text selection on the SVG, and a
    // drag whose pointer crossed a pane left the whole window reading as selected until the next
    // click. Selection is off for the document exactly while the pointer is down; text in the
    // panes is selectable again the moment the hand leaves the map.
    const releaseSelection = guardSelection();

    const move = (moved: PointerEvent) => {
      const dx = moved.clientX - start.x;
      const dy = moved.clientY - start.y;
      if (Math.abs(dx) > DRAG_SLOP || Math.abs(dy) > DRAG_SLOP) {
        draggedRef.current = true;
      }
      slide({ tx: origin.tx + dx, ty: origin.ty + dy, step: origin.step });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      // `pointercancel` as well as `pointerup`, because a gesture the browser takes over (a touch
      // becoming a scroll, for instance) would otherwise leave selection off everywhere for good.
      window.removeEventListener("pointercancel", up);
      releaseSelection();
      if (draggedRef.current) {
        commit(viewRef.current);
        setCursor(null);
        setMapFocused(false);
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  const zoomBy = useCallback(
    (steps: number) => {
      commit(zoomAt(viewRef.current, steps, size.width / 2, size.height / 2));
    },
    [commit, size]
  );

  const frameAll = useCallback(() => {
    const fitted = fitTo(
      onLevel.map((hex) => hex.coordinate),
      size.width,
      size.height,
      readInsets()
    );
    if (fitted) {
      commit(fitted);
    }
  }, [onLevel, size, commit, readInsets]);

  const onMapKeyDown = (event: React.KeyboardEvent<SVGPolygonElement>, from: Coordinate) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      // Unexplored ground is selectable too, and selects by position: an ally's coordinates are
      // the whole reason to be standing out here, and the panel can at least say which hex it is.
      selectRef.current(hexAt(onLevel, from)?.regionId ?? regionIdOf(from));
      return;
    }
    if (event.key === "+" || event.key === "=" || event.key === "-") {
      event.preventDefault();
      zoomBy(event.key === "-" ? -1 : 1);
      return;
    }
    if (event.key === "0") {
      event.preventDefault();
      frameAll();
      return;
    }
    if (!ARROWS.includes(event.key as ArrowKey)) {
      return;
    }
    // Alt+Arrow is the global unit walk, not the map cursor: handling it here too would move
    // both from one keypress, cursor and selection ending up in different hexes.
    if (event.altKey) {
      return;
    }
    event.preventDefault();

    if (event.shiftKey) {
      // Pans without moving focus, for reading around a hex without leaving it.
      const nudge = HEX_RADIUS * 2 * scaleOf(viewRef.current.step);
      const current = viewRef.current;
      const dx = event.key === "ArrowLeft" ? nudge : event.key === "ArrowRight" ? -nudge : 0;
      const dy = event.key === "ArrowUp" ? nudge : event.key === "ArrowDown" ? -nudge : 0;
      commit({ tx: current.tx + dx, ty: current.ty + dy, step: current.step });
      return;
    }

    // The cursor goes wherever it is pointed, however far outside what the faction knows: the
    // coordinates an ally names can lie a long way off the ground anybody has walked, and the view
    // follows the cursor there so it is never lost.
    const wanted = neighbour(from, event.key as ArrowKey);
    setCursor(wanted);
    pendingFocusRef.current = cursorKeyOf(wanted);
    if (isOffScreen(wanted, viewRef.current, size.width, size.height)) {
      commit(centreOn(wanted, viewRef.current, size.width, size.height));
    }
  };

  const band = zoomBand(view.step);

  // Padded by a viewport on each side so an ordinary drag never outruns the tick list, which is
  // only rebuilt when the view is committed.
  const ticksX = useMemo(
    () =>
      size.width === 0
        ? []
        : rulerTicks(
            "x",
            { ...view, tx: view.tx + size.width },
            size.width * 3,
            COLUMN_LABEL_ROOM
          ),
    [view, size]
  );
  const ticksY = useMemo(
    () =>
      size.height === 0
        ? []
        : rulerTicks("y", { ...view, ty: view.ty + size.height }, size.height * 3, ROW_LABEL_ROOM),
    [view, size]
  );

  const riskByHex = useMemo(
    () => new Map(routeRisk.map((hex) => [`${hex.coordinate.x},${hex.coordinate.y}`, hex.level])),
    [routeRisk]
  );
  const routeLine = useMemo(
    () =>
      route
        ? routeSegments([route.origin, ...route.hexes], route.solidSteps, level)
        : { solid: "", dotted: "" },
    [route, level]
  );
  // Risk is painted on hexes the unit enters, never its own - which is why the origin stays out.
  const routeOnLevel = useMemo(
    () => (route?.hexes ?? []).filter((step) => step.z === level),
    [route, level]
  );
  // Unexplored ground is selectable and has no hex to look up, so the ring is drawn from the id
  // itself. Only on this level: a selection made on another one is not on screen.
  const selectedAt = useMemo(() => {
    const coordinate = selectedRegionId === null ? null : parseRegionId(selectedRegionId);
    return coordinate?.z === level ? coordinate : null;
  }, [selectedRegionId, level]);

  // Where the cursor rests before anyone has moved it.
  const resting = cursor ?? selectedAt ?? onLevel[0]?.coordinate ?? null;
  const restingKey = resting ? cursorKeyOf(resting) : null;
  const overGround = resting ? hexAt(onLevel, resting) === null : false;

  return (
    <div ref={hostRef} className="absolute inset-0" data-testid="map-canvas">
      <svg
        ref={rootRef}
        className={`h-full w-full touch-none map-${band} map-theme-${theme.id}`}
        onPointerDown={onPointerDown}
      >
        <defs>
          <pattern
            ref={fogRef}
            id="fog-lattice"
            patternUnits="userSpaceOnUse"
            width={FOG_TILE.width}
            height={FOG_TILE.height}
          >
            <path
              d={FOG_TILE.d}
              fill="none"
              className="stroke-fog-edge"
              // A declaration rather than a presentation attribute. Chromium resolves the custom
              // property either way, but the desktop shell renders in the system webview and
              // older WebKit substitutes it only in a declaration.
              style={{ strokeWidth: "calc(1px / var(--map-scale, 1))" }}
            />
          </pattern>
          {showTextures
            ? TEXTURED_TERRAIN_NAMES.map((terrain) => (
                <pattern
                  key={terrain}
                  id={terrainTexturePatternId(terrain) ?? undefined}
                  patternUnits="objectBoundingBox"
                  patternContentUnits="objectBoundingBox"
                  width="1"
                  height="1"
                >
                  <image
                    href={terrainTextureUrl(terrain) ?? undefined}
                    x="0"
                    y="0"
                    width="1"
                    height="1"
                    preserveAspectRatio="xMidYMid slice"
                  />
                </pattern>
              ))
            : null}
          {/*
            Whatever gradients, hatches or filters the theme needs. The fog lattice and the biome
            patterns above are shared, because they are the same for every theme.
          */}
          {theme.Defs ? <theme.Defs /> : null}
        </defs>

        {/*
          The unexplored world, and the only thing that does not scale with how much is known.

          It is also the hit target for every hex nobody has described. There is no element out
          there to click - that is the point of drawing the fog as one rectangle - so the hex is
          worked out from where the pointer landed.
        */}
        <rect
          className="fill-ground"
          width="100%"
          height="100%"
          onClick={(event) => {
            if (draggedRef.current) {
              return;
            }
            const bounds = event.currentTarget.getBoundingClientRect();
            const coordinate = coordinateAt(
              event.clientX - bounds.left,
              event.clientY - bounds.top,
              viewRef.current,
              level
            );
            // Focus follows the click, as it does on a hex, so the arrow keys carry on from here.
            setCursor(coordinate);
            pendingFocusRef.current = cursorKeyOf(coordinate);
            selectRef.current(regionIdOf(coordinate));
          }}
        />
        <rect className="fill-terrain-unknown" width="100%" height="100%" pointerEvents="none" />
        <rect
          width="100%"
          height="100%"
          fill="url(#fog-lattice)"
          pointerEvents="none"
          aria-hidden="true"
        />

        {/* Transform is written by hand, never as a prop. See applyView. */}
        <g ref={worldRef} data-testid="map-world">
          {/*
            Weakest knowledge first, so a hex the report describes in full is never painted
            underneath one a neighbour merely mentioned.
          */}
          <theme.TerrainLayer views={buckets.named} />
          <theme.TerrainLayer views={buckets.stale} />
          <theme.TerrainLayer views={buckets.current} />

          {/* Beneath the route overlay, so a movement path crosses a road the way a traveller would. */}
          <theme.RoadLayer views={allViews} />

          {(routeLine.solid || routeLine.dotted) && (
            <g pointerEvents="none">
              {/* A casing under each line, so a route stays readable over any terrain. */}
              {routeLine.solid && (
                <>
                  <polyline
                    points={routeLine.solid}
                    fill="none"
                    className="stroke-ground"
                    strokeWidth={5}
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                  />
                  <polyline
                    points={routeLine.solid}
                    fill="none"
                    className="stroke-brass"
                    strokeWidth={3}
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                    data-testid="route-line-solid"
                  />
                </>
              )}
              {routeLine.dotted && (
                <>
                  <polyline
                    points={routeLine.dotted}
                    fill="none"
                    className="stroke-ground"
                    strokeWidth={5}
                    strokeLinejoin="round"
                    strokeDasharray="6 6"
                    vectorEffect="non-scaling-stroke"
                  />
                  <polyline
                    points={routeLine.dotted}
                    fill="none"
                    className="stroke-brass"
                    strokeWidth={3}
                    strokeLinejoin="round"
                    strokeDasharray="6 6"
                    vectorEffect="non-scaling-stroke"
                    data-testid="route-line-dotted"
                  />
                </>
              )}
              {routeOnLevel.map((step, index) => {
                const world = worldOf(step);
                const risk = riskByHex.get(`${step.x},${step.y}`) ?? "low";
                return (
                  <polygon
                    key={`${step.x},${step.y},${index}`}
                    points={HEX_POINTS}
                    transform={`translate(${world.x},${world.y})`}
                    className={RISK_CLASSES[risk]}
                    fillOpacity={0.28}
                    strokeWidth={2}
                    vectorEffect="non-scaling-stroke"
                  />
                );
              })}
            </g>
          )}

          <theme.MarkLayer views={allViews} />

          {/*
            The export rectangle, while it is being dragged. Hidden and moved by hand rather than
            by props; see startMarquee.
          */}
          <rect
            ref={marqueeRef}
            visibility="hidden"
            className="fill-brass-bright/10 stroke-brass-bright"
            strokeWidth={1.5}
            strokeDasharray="5 4"
            vectorEffect="non-scaling-stroke"
            pointerEvents="none"
            data-testid="map-marquee"
          />

          {selectedAt && (
            <polygon
              points={HEX_POINTS}
              transform={translateAt(selectedAt)}
              fill="none"
              className="stroke-brass"
              strokeWidth={2.5}
              vectorEffect="non-scaling-stroke"
              pointerEvents="none"
            />
          )}

          {/*
            Where the keyboard is, drawn separately from where the selection is: arrowing across
            the map moves focus without selecting anything, and with nothing on screen to show it
            the arrow keys read as dead. Dashed so the two rings are never confused, and only while
            the map actually holds focus.
          */}
          {mapFocused && resting && (
            <polygon
              points={HEX_POINTS}
              transform={translateAt(resting)}
              fill="none"
              className="stroke-brass-bright"
              strokeWidth={2}
              strokeDasharray="4 3"
              vectorEffect="non-scaling-stroke"
              pointerEvents="none"
              data-testid="map-focus-ring"
            />
          )}

          {/*
            The hit and accessibility layer: flat, in model order, and last so nothing paints over
            it. Keeping it separate from the terrain buckets is what stops a hex being remounted —
            and losing focus mid-keystroke — when its knowledge changes.
          */}
          <g
            onFocus={() => setMapFocused(true)}
            onBlur={(event) => {
              // Moving between hexes blurs one and focuses the next; only leaving the map entirely
              // should put the ring away.
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                setMapFocused(false);
              }
            }}
          >
            {onLevel.map((hex) => (
              <polygon
                key={hex.regionId}
                data-region-id={hex.regionId}
                data-cursor={cursorKeyOf(hex.coordinate)}
                points={HEX_POINTS}
                transform={translateOf(hex)}
                fill="none"
                pointerEvents="all"
                className="cursor-pointer outline-none"
                strokeWidth={2}
                vectorEffect="non-scaling-stroke"
                role="button"
                tabIndex={cursorKeyOf(hex.coordinate) === restingKey ? 0 : -1}
                aria-label={`hex ${hex.regionId}`}
                aria-pressed={hex.regionId === selectedRegionId}
                onFocus={() => setCursor(hex.coordinate)}
                onKeyDown={(event) => onMapKeyDown(event, hex.coordinate)}
                onClick={(event) => {
                  if (draggedRef.current) {
                    return;
                  }
                  // Focused as well as selected, so the arrow keys carry on from the hex just
                  // clicked. Chromium happens to focus an SVG shape on pointerdown anyway, but
                  // that is not something to rely on across the two shells' webviews.
                  event.currentTarget.focus();
                  selectRef.current(hex.regionId);
                }}
              >
                <title>{hex.label}</title>
              </polygon>
            ))}

            {/*
              The cursor standing on ground nobody has visited.

              Unexplored hexes are a single patterned rectangle, so there is no element out there to
              focus. This is the one that carries the cursor across the gap between two islands of
              known ground - and it is selectable, because coordinates an ally names are the whole
              reason to be out here. It takes no pointer events: a click lands on the fog rectangle
              beneath, which works out the hex wherever the pointer is rather than only under the
              cursor.
            */}
            {resting && overGround && (
              <polygon
                data-cursor={restingKey}
                data-testid="map-cursor"
                points={HEX_POINTS}
                transform={translateAt(resting)}
                fill="none"
                pointerEvents="none"
                className="outline-none"
                role="button"
                tabIndex={0}
                aria-label={`unexplored ${regionIdOf(resting)}`}
                aria-pressed={regionIdOf(resting) === selectedRegionId}
                onKeyDown={(event) => onMapKeyDown(event, resting)}
              />
            )}
          </g>
        </g>

        {/* Rulers, pinned to the viewport so they never scroll away. */}
        <g ref={rulerXRef} pointerEvents="none" aria-hidden="true" data-testid="map-ruler-x">
          {ticksX.map((tick) => (
            <g key={tick.index} className="fill-ink-soft">
              <text x={tick.offset} y={13} textAnchor="middle" fontSize={10}>
                {tick.index}
              </text>
              <text x={tick.offset} y={size.height - 5} textAnchor="middle" fontSize={10}>
                {tick.index}
              </text>
            </g>
          ))}
        </g>
        <g ref={rulerYRef} pointerEvents="none" aria-hidden="true" data-testid="map-ruler-y">
          {ticksY.map((tick) => (
            <g key={tick.index} className="fill-ink-soft">
              <text x={4} y={tick.offset} dominantBaseline="middle" fontSize={10}>
                {tick.index}
              </text>
              <text
                x={size.width - 4}
                y={tick.offset}
                textAnchor="end"
                dominantBaseline="middle"
                fontSize={10}
              >
                {tick.index}
              </text>
            </g>
          ))}
        </g>
      </svg>

      {/*
        Along the top, beside the layer chips. The inspector panels cover the rest of the map with
        a full-bleed overlay that only clears the first forty-eight pixels, so controls anywhere
        else are unreachable however visible they look.
      */}
      <div className="absolute right-2.5 top-2.5 flex gap-1">
        <ZoomButton label="Zoom in" onClick={() => zoomBy(1)}>
          +
        </ZoomButton>
        <ZoomButton label="Zoom out" onClick={() => zoomBy(-1)}>
          −
        </ZoomButton>
        <ZoomButton label="Zoom to fit" onClick={frameAll}>
          ⤢
        </ZoomButton>
      </div>
    </div>
  );
}

function translateAt(coordinate: Coordinate): string {
  const world = worldOf(coordinate);
  return `translate(${world.x.toFixed(2)},${world.y.toFixed(2)})`;
}

function translateOf(hex: HexNode): string {
  return translateAt(hex.coordinate);
}

function ZoomButton({
  label,
  onClick,
  children
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="h-7 w-7 rounded border border-edge bg-panel/95 text-ink-soft shadow hover:text-ink"
    >
      {children}
    </button>
  );
}
