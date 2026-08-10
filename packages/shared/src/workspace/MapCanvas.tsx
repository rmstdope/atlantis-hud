import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Coordinate, HexRisk } from "@atlantis/core-client";
import type { HexMapModel, HexNode } from "../hexMapModel";
import {
  accumulateWheel,
  centreOn,
  fitTo,
  hexBounds,
  HEX_RADIUS,
  isOffScreen,
  isWithinReach,
  neighbour,
  rulerTicks,
  scaleOf,
  transformString,
  wheelPixels,
  worldOf,
  zoomAt,
  zoomBand,
  type ArrowKey,
  type Viewport
} from "./mapViewport";
import { loadSavedViewport, saveViewportForGame } from "./mapViewportStorage";
import { guardSelection } from "./selectionGuard";
import {
  fogPatternTile,
  hexLayers,
  hexPaint,
  hexPointsAttribute,
  routePoints,
  terrainTexturePatternId,
  terrainTextureUrl,
  unitPipRadius
} from "./mapHexView";

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

/** How far past the edge of what the faction knows the cursor may wander. */
const CURSOR_MARGIN = 6;

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
  level: number;
  selectedRegionId: string | null;
  onSelectRegion: (regionId: string) => void;
  showStaleness: boolean;
  showTextures: boolean;
  showUnits: boolean;
  showStructures: boolean;
  /** Hexes a planned route passes through, in order. Empty when nothing is planned. */
  route?: Coordinate[];
  /** How dangerous each of those hexes is, so one bad step is visible rather than buried. */
  routeRisk?: HexRisk[];
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
  level,
  selectedRegionId,
  onSelectRegion,
  showStaleness,
  showTextures,
  showUnits,
  showStructures,
  route = [],
  routeRisk = []
}: MapCanvasProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<SVGSVGElement | null>(null);
  const worldRef = useRef<SVGGElement | null>(null);
  const fogRef = useRef<SVGPatternElement | null>(null);
  const rulerXRef = useRef<SVGGElement | null>(null);
  const rulerYRef = useRef<SVGGElement | null>(null);

  const viewRef = useRef<Viewport>(ORIGIN);
  const carryRef = useRef(0);
  const draggedRef = useRef(false);
  const pendingFocusRef = useRef<string | null>(null);
  const framedRef = useRef<{ model: HexMapModel | null; level: number | null }>({
    model: null,
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

  // Holds a viewport that should be applied the next time the frame effect runs. Set when the game
  // changes and the player has a saved position for it; cleared once the position is applied.
  const pendingRestoreRef = useRef<Viewport | null>(null);

  const layers = useMemo(() => hexLayers(model.hexes, level), [model, level]);
  const onLevel = useMemo(
    () => model.hexes.filter((hex) => hex.coordinate.z === level),
    [model, level]
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

  // Loads the saved viewport when the game changes so it is ready for the frame effect below.
  // This effect runs before the frame effect (effects fire in definition order), which is what
  // makes the restore win over the default fit when both happen in the same render cycle.
  useEffect(() => {
    if (gameId === null) {
      pendingRestoreRef.current = null;
      return;
    }
    pendingRestoreRef.current = loadSavedViewport(gameId);
  }, [gameId]);

  // Frames the world when the report or the level changes. Another level's hexes can sit somewhere
  // completely different, so keeping the old transform would open on empty fog.
  useEffect(() => {
    if (size.width === 0 || size.height === 0) {
      return;
    }
    const framed = framedRef.current;
    if (framed.model === model && framed.level === level) {
      return;
    }
    framedRef.current = { model, level };

    // If a saved viewport is waiting (game just opened), restore it instead of fitting to the map.
    if (pendingRestoreRef.current) {
      const restored = pendingRestoreRef.current;
      pendingRestoreRef.current = null;
      commit(restored);
      return;
    }

    const fitted = fitTo(
      onLevel.map((hex) => hex.coordinate),
      size.width,
      size.height
    );
    if (fitted) {
      commit(fitted);
    }
  }, [model, level, onLevel, size, commit]);

  // Brings the selection into view when it arrives from somewhere other than the map — the units
  // table, or a restored session. A hex clicked on the map is already visible, so nothing moves.
  useEffect(() => {
    if (!selectedRegionId || size.width === 0) {
      return;
    }
    const hex = onLevel.find((node) => node.regionId === selectedRegionId);
    if (hex && isOffScreen(hex.coordinate, viewRef.current, size.width, size.height)) {
      commit(centreOn(hex.coordinate, viewRef.current, size.width, size.height));
    }
  }, [selectedRegionId, onLevel, size, commit]);

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

  const onPointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) {
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
      size.height
    );
    if (fitted) {
      commit(fitted);
    }
  }, [onLevel, size, commit]);

  const onMapKeyDown = (event: React.KeyboardEvent<SVGPolygonElement>, from: Coordinate) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      // Only a hex can be selected. Standing on unexplored ground is allowed and does nothing,
      // which is the honest answer: there is nothing there to inspect.
      const here = hexAt(onLevel, from);
      if (here) {
        selectRef.current(here.regionId);
      }
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

    const wanted = neighbour(from, event.key as ArrowKey);
    // The cursor crosses unexplored ground rather than stopping at the edge of what is known:
    // otherwise two islands of visited hexes with unvisited ground between them cannot be reached
    // from one another, and half the map is unnavigable by keyboard.
    if (!isWithinReach(wanted, reach, CURSOR_MARGIN)) {
      return;
    }
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
  const routeLine = useMemo(() => routePoints(route, level), [route, level]);
  const routeOnLevel = useMemo(() => route.filter((step) => step.z === level), [route, level]);
  const reach = useMemo(() => hexBounds(onLevel.map((hex) => hex.coordinate)), [onLevel]);

  const selected = onLevel.find((hex) => hex.regionId === selectedRegionId) ?? null;

  // Where the cursor rests before anyone has moved it, and how far it may go from there.
  const resting = cursor ?? selected?.coordinate ?? onLevel[0]?.coordinate ?? null;
  const restingKey = resting ? cursorKeyOf(resting) : null;
  const overGround = resting ? hexAt(onLevel, resting) === null : false;

  return (
    <div ref={hostRef} className="absolute inset-0" data-testid="map-canvas">
      <svg
        ref={rootRef}
        className={`h-full w-full touch-none map-${band}`}
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
          <pattern
            id="stale-hatch"
            width="5"
            height="5"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <line x1="0" y1="0" x2="0" y2="5" className="stroke-ink-soft" strokeOpacity="0.22" />
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
        </defs>

        {/* The unexplored world, and the only thing that does not scale with how much is known. */}
        <rect className="fill-ground" width="100%" height="100%" />
        <rect className="fill-terrain-unknown" width="100%" height="100%" pointerEvents="none" />
        <rect
          width="100%"
          height="100%"
          fill="url(#fog-lattice)"
          pointerEvents="none"
          aria-hidden="true"
        />

        {/* Transform is written by hand, never as a prop. See applyView. */}
        <g ref={worldRef}>
          <HexLayer hexes={layers.named} showStaleness={showStaleness} showTextures={showTextures} />
          <HexLayer hexes={layers.stale} showStaleness={showStaleness} showTextures={showTextures} />
          <HexLayer
            hexes={layers.current}
            showStaleness={showStaleness}
            showTextures={showTextures}
          />

          {routeLine && (
            <g pointerEvents="none">
              {/* A casing under the line, so a route stays readable over any terrain. */}
              <polyline
                points={routeLine}
                fill="none"
                className="stroke-ground"
                strokeWidth={5}
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
              <polyline
                points={routeLine}
                fill="none"
                className="stroke-brass"
                strokeWidth={3}
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
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

          <MarkLayer hexes={onLevel} showUnits={showUnits} showStructures={showStructures} />

          {selected && (
            <polygon
              points={HEX_POINTS}
              transform={translateOf(selected)}
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
              known ground. Deliberately not a button: there is nothing here to select, and giving
              it that role would make it answer to searches for a hex it is not.
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
                tabIndex={0}
                aria-label={`unexplored ${level}:${resting.x},${resting.y}`}
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

/** One knowledge bucket. Split out so a selection change does not reconcile the terrain. */
function HexLayer({
  hexes,
  showStaleness,
  showTextures
}: {
  hexes: HexNode[];
  showStaleness: boolean;
  showTextures: boolean;
}) {
  return (
    <g pointerEvents="none">
      {hexes.map((hex) => {
        const paint = hexPaint(hex, showStaleness);
        const transform = translateOf(hex);
        return (
          <g key={hex.regionId}>
            <polygon
              points={HEX_POINTS}
              transform={transform}
              className={`${paint.terrainClass} stroke-map-edge`}
              style={
                showTextures && paint.texturePatternId
                  ? { fill: `url(#${paint.texturePatternId})` }
                  : undefined
              }
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
            {paint.fogOpacity > 0 && (
              <polygon
                points={HEX_POINTS}
                transform={transform}
                className="fill-terrain-unknown"
                fillOpacity={paint.fogOpacity}
              />
            )}
            {paint.hatched && (
              <polygon points={HEX_POINTS} transform={transform} fill="url(#stale-hatch)" />
            )}
          </g>
        );
      })}
    </g>
  );
}

/** Settlements, units and structures. What of it shows is decided by the zoom band, in CSS. */
function MarkLayer({
  hexes,
  showUnits,
  showStructures
}: {
  hexes: HexNode[];
  showUnits: boolean;
  showStructures: boolean;
}) {
  return (
    <g pointerEvents="none">
      {hexes.map((hex) => {
        const world = worldOf(hex.coordinate);
        const own = unitPipRadius(hex.ownUnitCount);
        const foreign = unitPipRadius(hex.foreignUnitCount);
        const structures = hex.region?.structures?.length ?? 0;
        return (
          <g key={hex.regionId}>
            {hex.settlementName && (
              <>
                <text
                  className="map-label map-name fill-settlement"
                  x={world.x}
                  y={world.y - HEX_RADIUS - 3}
                  textAnchor="middle"
                >
                  {hex.settlementName}
                </text>
                <text
                  className="map-glyph fill-settlement"
                  x={world.x}
                  y={world.y + 3}
                  textAnchor="middle"
                  fontSize={9}
                >
                  ▣
                </text>
              </>
            )}
            {showUnits && own > 0 && (
              <circle
                className="map-pip fill-unit-own"
                cx={world.x - 4}
                cy={world.y + HEX_RADIUS * 0.55}
                r={own}
              />
            )}
            {showUnits && foreign > 0 && (
              <circle
                className="map-pip fill-unit-foreign"
                cx={world.x + 4}
                cy={world.y + HEX_RADIUS * 0.55}
                r={foreign}
              />
            )}
            {showUnits && hex.ownUnitCount + hex.foreignUnitCount > 0 && (
              <text
                className="map-label map-count fill-ink"
                x={world.x}
                y={world.y - 4}
                textAnchor="middle"
              >
                {hex.ownUnitCount}
                {hex.foreignUnitCount > 0 ? `/${hex.foreignUnitCount}` : ""}
              </text>
            )}
            {showStructures && structures > 0 && (
              <text
                className="map-glyph fill-brass"
                x={world.x + HEX_RADIUS * 0.5}
                y={world.y - HEX_RADIUS * 0.4}
                textAnchor="middle"
                fontSize={7}
              >
                ⌂
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
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
