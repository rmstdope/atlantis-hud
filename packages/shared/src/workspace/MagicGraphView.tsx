import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type Ref
} from "react";
import {
  centreNode,
  edgeKey,
  fitGraph,
  labelBand,
  lineageOf,
  NODE_HEIGHT,
  NODE_WIDTH,
  PAN_STEP,
  type GraphNode,
  type LabelBand,
  type MagicGraph
} from "./magicGraphLayout";
import {
  accumulateWheel,
  scaleOf,
  transformString,
  wheelPixels,
  zoomAt,
  type Viewport
} from "./mapViewport";
import { guardSelection } from "./selectionGuard";

/**
 * The whole magic prerequisite graph: seventy skills in five tiers, and the hundred and two lines
 * between them, drawn as one pannable picture.
 *
 * The companion to `MagicTreeDialog`'s branch cards, and the honest shape of the same data - a DAG
 * thirty-eight skills wide in its middle tier, which cannot reflow and so pans and zooms at every
 * window width. `docs/ui/ah-gjbs.2-whole-graph.html` is the design.
 *
 * **Split in two on purpose.** `MagicGraphDrawing` is hook-free and holds everything that is in the
 * markup; `MagicGraphView` owns the viewport, the gestures and the measuring. That is the split
 * `packages/shared/src/testing/README.md` asks for - this package has no jsdom (ah-nass), so a
 * component that used hooks could not be entered by `findByTestId` at all, and every click test
 * below would be unreachable rather than merely untested.
 */

const ORIGIN: Viewport = { tx: 0, ty: 0, step: 0 };

/** How far the pointer may travel before a press stops counting as a click on a skill. */
const DRAG_SLOP = 4;

/**
 * Text and hairlines live inside the scaled world group, so their size is divided back out and
 * they stay constant on screen. `theme.css`'s `.map-label` does exactly this with `--map-scale`.
 *
 * The `, 1` fallback is not decoration: a static render sets no custom property, and without it
 * every `font-size` computes to `NaN` and the markup carries no readable text at all.
 */
const constant = (pixels: number) => `calc(${pixels}px / var(--graph-scale, 1))`;

const NAME_STYLE = { fontSize: constant(10.5) } as const;
const TAG_STYLE = { fontSize: constant(10) } as const;
const TIER_TITLE_STYLE = { fontSize: constant(12) } as const;
const TIER_COUNT_STYLE = { fontSize: constant(10) } as const;
const LEVEL_STYLE = { fontSize: constant(8.5) } as const;
const EDGE_STYLE = { strokeWidth: constant(1), fill: "none" } as const;
const LIT_EDGE_STYLE = { strokeWidth: constant(1.6), fill: "none" } as const;
const LONG_EDGE_STYLE = { ...EDGE_STYLE, strokeDasharray: constant(3) + " " + constant(2) } as const;
const LONG_LIT_EDGE_STYLE = {
  ...LIT_EDGE_STYLE,
  strokeDasharray: constant(3) + " " + constant(2)
} as const;
const BOX_STYLE = { strokeWidth: constant(1) } as const;
const LIT_BOX_STYLE = { strokeWidth: constant(2) } as const;
const APPRENTICE_BOX_STYLE = {
  strokeWidth: constant(1),
  strokeDasharray: constant(3) + " " + constant(2)
} as const;

/** What the graph tells a screen reader it is, and where the readable form lives. */
export function graphAriaLabel(graph: MagicGraph): string {
  return (
    `Whole graph: ${graph.nodes.length} magic skills in ${graph.tiers.length} tiers, drawn as a ` +
    "diagram. Arrow keys pan, plus and minus zoom. Switch to Branches to read the skills as a list."
  );
}

/**
 * The picture itself, and nothing else: no state, no effects, no measurement.
 *
 * Everything the gestures need is passed in, so this stays a function of its props and a test can
 * walk it. `wasDragged` is how a pan that ended over a skill is kept from reading as a click on
 * it.
 */
export function MagicGraphDrawing({
  graph,
  lit,
  viewport,
  onLight,
  onOpenGameData,
  wasDragged,
  hostRef,
  rootRef,
  worldRef,
  onPointerDown,
  onKeyDown
}: {
  graph: MagicGraph;
  /** The current skill, whose lineage is lit. Null lights nothing and dims nothing. */
  lit: string | null;
  /** Where the view is, or null before anything has placed it - then it draws at the origin. */
  viewport: Viewport | null;
  /** A first click on a skill, or a click on empty background, which passes null. */
  onLight: (tag: string | null) => void;
  /** A second click on the already-lit skill. Takes the dictionary id, e.g. `skill:CRRI`. */
  onOpenGameData: (entryId: string) => void;
  wasDragged?: () => boolean;
  hostRef?: Ref<HTMLDivElement>;
  rootRef?: Ref<SVGSVGElement>;
  worldRef?: Ref<SVGGElement>;
  onPointerDown?: (event: React.PointerEvent<SVGSVGElement>) => void;
  onKeyDown?: (event: React.KeyboardEvent<SVGSVGElement>) => void;
}) {
  const view = viewport ?? ORIGIN;
  const band = labelBand(view.step);
  const lineage = lit === null ? null : lineageOf(graph, lit);
  const dragged = () => wasDragged?.() === true;

  return (
    <div ref={hostRef} className="relative h-full min-h-0 w-full overflow-hidden">
      <svg
        data-testid="magic-graph"
        ref={rootRef}
        tabIndex={0}
        // A picture, and it says so: the branch view is the readable form, and the label points at
        // it. A list of seventy controls here would be a second copy of that view, free to drift.
        role="img"
        aria-label={graphAriaLabel(graph)}
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
        onClick={(event) => {
          // The root itself, not a skill: a click that landed on one bubbles with a different
          // target. The same guard `GameDataDialog` uses for its backdrop.
          if (event.target === event.currentTarget && !dragged()) {
            onLight(null);
          }
        }}
        className="h-full w-full touch-none select-none outline-none"
        style={{ ["--graph-scale" as string]: scaleOf(view.step).toFixed(4) }}
      >
        <g data-testid="magic-graph-world" ref={worldRef} transform={transformString(view)}>
          {graph.tiers.map((tier) => (
            <g key={tier.depth} data-testid={`magic-graph-tier-${tier.depth}`}>
              <text
                x={tier.x}
                y={28}
                style={TIER_TITLE_STYLE}
                className="fill-brass uppercase tracking-wider"
              >
                {tier.title}
              </text>
              <text x={tier.x} y={41} style={TIER_COUNT_STYLE} className="fill-ink-dim">
                {tier.count} skills
              </text>
            </g>
          ))}

          {graph.edges.map((edge) => {
            const key = edgeKey(edge.from, edge.to);
            const isLit = lineage?.edges.has(key) === true;
            const faded = lineage !== null && !isLit;
            return (
              <g key={key} data-testid={`magic-graph-edge-${edge.from}-${edge.to}`}>
                <path
                  d={edge.path}
                  style={
                    edge.long
                      ? isLit
                        ? LONG_LIT_EDGE_STYLE
                        : LONG_EDGE_STYLE
                      : isLit
                        ? LIT_EDGE_STYLE
                        : EDGE_STYLE
                  }
                  className={`${isLit ? "stroke-brass" : "stroke-edge"} ${faded ? "opacity-[0.13]" : ""}`}
                />
                {band === "names" ? (
                  <text
                    x={edge.labelX}
                    y={edge.labelY}
                    textAnchor="end"
                    style={LEVEL_STYLE}
                    className={`fill-ink-dim ${faded ? "opacity-[0.13]" : ""}`}
                  >
                    {edge.level}
                  </text>
                ) : null}
              </g>
            );
          })}

          {graph.nodes.map((node) => (
            <Skill
              key={node.tag}
              node={node}
              band={band}
              lit={lit === node.tag}
              dimmed={lineage !== null && !lineage.skills.has(node.tag)}
              onClick={() => {
                if (dragged()) {
                  return;
                }
                if (lit === node.tag) {
                  onOpenGameData(node.id);
                } else {
                  onLight(node.tag);
                }
              }}
            />
          ))}
        </g>
      </svg>
    </div>
  );
}

function Skill({
  node,
  band,
  lit,
  dimmed,
  onClick
}: {
  node: GraphNode;
  band: LabelBand;
  lit: boolean;
  dimmed: boolean;
  onClick: () => void;
}) {
  const foundation = node.kind === "foundation";
  const apprentice = node.kind === "apprenticeship";
  return (
    <g
      data-testid={`magic-graph-skill-${node.tag}`}
      // Hidden from a reader rather than offered as seventy stops it cannot pan between: K1, and
      // the root's own label names the branch view as the way to read these.
      aria-hidden
      onClick={onClick}
      className={`cursor-pointer ${dimmed ? "opacity-[0.22]" : ""}`}
    >
      <rect
        x={node.x}
        y={node.y}
        width={NODE_WIDTH}
        height={NODE_HEIGHT}
        rx={3}
        style={lit ? LIT_BOX_STYLE : apprentice ? APPRENTICE_BOX_STYLE : BOX_STYLE}
        className={`fill-panel-raised ${
          lit
            ? "stroke-brass-bright"
            : foundation
              ? "stroke-brass"
              : apprentice
                ? "stroke-select"
                : "stroke-edge"
        }`}
      />
      {band === "none" ? null : band === "names" ? (
        <text
          x={node.x + 7}
          y={node.y + NODE_HEIGHT / 2 + 3.5}
          style={NAME_STYLE}
          className={
            foundation ? "fill-brass-bright font-semibold" : apprentice ? "fill-select" : "fill-ink"
          }
        >
          {node.name}
        </text>
      ) : (
        <text
          x={node.x + 7}
          y={node.y + NODE_HEIGHT / 2 + 3.5}
          style={TAG_STYLE}
          className={
            foundation ? "fill-brass-bright font-semibold" : apprentice ? "fill-select" : "fill-ink-dim"
          }
        >
          {node.tag}
        </text>
      )}
    </g>
  );
}

/** What the dialog's zoom buttons drive, hoisted the way `MapCanvas` hoists the map's own. */
export type MagicGraphHandle = { zoomBy: (steps: number) => void; fitAll: () => void };

/**
 * The graph, with its gestures: pan, zoom, keyboard, and the one measurement everything else
 * waits for.
 *
 * The viewport is written straight to the DOM while a gesture is in flight and committed once at
 * the end - the same split `MapCanvas` uses, and for the same reason: a drag that re-rendered on
 * every pointer move drags badly. The label band is derived from the **prop**, not the live ref,
 * so a drag - which never changes the step - can never need the markup to change.
 */
export function MagicGraphView({
  graph,
  lit,
  onLight,
  onOpenGameData,
  viewport,
  onViewport,
  handleRef
}: {
  graph: MagicGraph;
  lit: string | null;
  onLight: (tag: string | null) => void;
  onOpenGameData: (entryId: string) => void;
  /** Where the view is, or null when it has never been placed - then it fits on mount. */
  viewport: Viewport | null;
  /** Called once at the end of every gesture, never during one. */
  onViewport: (viewport: Viewport) => void;
  handleRef?: Ref<MagicGraphHandle>;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<SVGSVGElement | null>(null);
  const worldRef = useRef<SVGGElement | null>(null);
  const viewRef = useRef<Viewport>(viewport ?? ORIGIN);
  const carryRef = useRef(0);
  const draggedRef = useRef(false);
  const placedRef = useRef(false);
  const [size, setSize] = useState({ width: 0, height: 0 });

  const applyView = useCallback(() => {
    const current = viewRef.current;
    worldRef.current?.setAttribute("transform", transformString(current));
    rootRef.current?.style.setProperty("--graph-scale", scaleOf(current.step).toFixed(4));
  }, []);

  const commit = useCallback(
    (next: Viewport) => {
      viewRef.current = next;
      applyView();
      onViewport(next);
    },
    [applyView, onViewport]
  );

  const slide = useCallback(
    (next: Viewport) => {
      viewRef.current = next;
      applyView();
    },
    [applyView]
  );

  // After every render, not only when the view changes: a re-render that remounted the group would
  // otherwise leave the graph sitting at the origin.
  useLayoutEffect(applyView);

  // The dialog resizes to 94vw as this view mounts, so the first paint must not be fitted against
  // the branch view's old width. Same-numbers guard, as `MapCanvas` has.
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

  /**
   * Where the view opens, decided once, as soon as there is a size to decide against.
   *
   * Mounting is the whole of the memory story: the dialog renders one view or the other, never
   * both, so switching views unmounts this and switching back mounts it again with whatever
   * viewport was last committed. Nothing here needs an epoch or a one-shot request.
   */
  useEffect(() => {
    if (placedRef.current || size.width === 0 || size.height === 0) {
      return;
    }
    placedRef.current = true;
    const base = viewport ?? fitGraph(graph, size.width, size.height);
    const node = lit === null ? undefined : graph.nodes.find((candidate) => candidate.tag === lit);
    if (node !== undefined) {
      // At least 100%, so an arrived-at skill's name is readable - and never zooming a reader back
      // out from wherever they had got to.
      commit(
        centreNode(node, { ...base, step: Math.max(base.step, 0) }, size.width, size.height)
      );
      return;
    }
    if (viewport === null) {
      commit(fitGraph(graph, size.width, size.height));
      return;
    }
    slide(viewport);
  }, [size, graph, lit, viewport, commit, slide]);

  // React attaches `wheel` passively, so `preventDefault` inside an `onWheel` prop does nothing and
  // the dialog body scrolls instead of the graph zooming. It has to be a manual listener.
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

  const zoomBy = useCallback(
    (steps: number) => {
      commit(zoomAt(viewRef.current, steps, size.width / 2, size.height / 2));
    },
    [commit, size]
  );

  const fitAll = useCallback(() => {
    commit(fitGraph(graph, size.width, size.height));
  }, [commit, graph, size]);

  useImperativeHandle(handleRef, () => ({ zoomBy, fitAll }), [zoomBy, fitAll]);

  const onPointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) {
      return;
    }
    draggedRef.current = false;
    const start = { x: event.clientX, y: event.clientY };
    const origin = viewRef.current;
    // Deliberately no `setPointerCapture`: capturing on the root retargets the click to the
    // capturing element, so no skill would ever receive one and the graph would pan but refuse to
    // select. The window listeners below already carry a drag outside the element.

    // WebKit - the engine the desktop shell runs in - anchors a native text selection on the SVG,
    // and a drag whose pointer crossed the dialog edge leaves the window reading as selected until
    // the next click.
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
      // `pointercancel` too, or a gesture the browser takes over leaves selection off for good.
      window.removeEventListener("pointercancel", up);
      releaseSelection();
      if (draggedRef.current) {
        commit(viewRef.current);
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  const onKeyDown = (event: React.KeyboardEvent<SVGSVGElement>) => {
    const view = viewRef.current;
    switch (event.key) {
      case "ArrowLeft":
      case "ArrowRight":
      case "ArrowUp":
      case "ArrowDown": {
        // Without this the arrows scroll the dialog instead of panning the graph.
        event.preventDefault();
        const dx = event.key === "ArrowLeft" ? PAN_STEP : event.key === "ArrowRight" ? -PAN_STEP : 0;
        const dy = event.key === "ArrowUp" ? PAN_STEP : event.key === "ArrowDown" ? -PAN_STEP : 0;
        commit({ tx: view.tx + dx, ty: view.ty + dy, step: view.step });
        return;
      }
      case "+":
      case "=":
      case "-":
        event.preventDefault();
        zoomBy(event.key === "-" ? -1 : 1);
        return;
      case "0":
        event.preventDefault();
        fitAll();
        return;
      default:
        // Escape is `useEscapeToDismiss`'s, and it closes the dialog whether or not a skill is lit.
        return;
    }
  };

  return (
    <MagicGraphDrawing
      graph={graph}
      lit={lit}
      viewport={viewport}
      onLight={onLight}
      onOpenGameData={onOpenGameData}
      wasDragged={() => draggedRef.current}
      hostRef={hostRef}
      rootRef={rootRef}
      worldRef={worldRef}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
    />
  );
}
