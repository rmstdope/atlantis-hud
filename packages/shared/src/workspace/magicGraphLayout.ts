/**
 * The layered drawing of the magic study tree: where every skill sits, where every prerequisite
 * line runs, and where the view has to be to show them.
 *
 * Everything here is a pure function of the `MagicTree` `magicTree.ts` already builds - no React,
 * no DOM, no measurement. `MagicGraphView` renders what this returns and measures the browser;
 * this module is what the tests target, which is the split `packages/shared/src/testing/README.md`
 * asks for in a package with no jsdom.
 *
 * Nothing here holds a table of skills, tiers or positions: every one is derived, so a
 * `pnpm run atlantis refresh` that adds a magic skill places it with no code change at all.
 */

import type { MagicTree } from "../magicTree";
import {
  MAX_STEP,
  MIN_STEP,
  scaleOf,
  STEPS_PER_DOUBLING,
  type Viewport
} from "./mapViewport";

/** Which of the dialog's two views is showing. Lives in `AppShell`, so it outlives the dialog. */
export type MagicTreeView = "branches" | "graph";

/** How far one arrow press moves the view, in screen pixels. */
export const PAN_STEP = 80;

/** Node box geometry, in world units. The view transform scales these; they never change. */
export const NODE_WIDTH = 208;
export const NODE_HEIGHT = 22;
export const NODE_GAP = 5;
/** Horizontal distance between one tier's left edge and the next. */
export const TIER_PITCH = 268;
export const PAD_LEFT = 26;
export const PAD_TOP = 50;

/** Room under the deepest node, so the drawing does not end flush against its last box. */
const PAD_BOTTOM = 24;

/**
 * Vertical distance between one box's top and the next's, in world units. The closest two skills
 * in a column may ever sit; a box slides freely otherwise.
 */
export const ROW_PITCH = NODE_HEIGHT + NODE_GAP;

/** Passes that pull from one side at a time, prerequisites then dependents, alternating. */
const ALTERNATING_SWEEPS = 4;
/** Passes that pull from both sides at once, run after the alternating ones. */
const SETTLING_SWEEPS = 4;

/** How a node's box is drawn. `MANI` is set apart because it is not a Foundation. */
export type NodeKind = "foundation" | "apprenticeship" | "skill";

export type GraphNode = {
  tag: string;
  name: string;
  /** The game data dictionary id, e.g. `skill:CRRI`. Taken straight from `MagicSkillNode.id`. */
  id: string;
  depth: number;
  kind: NodeKind;
  /** Top-left of the box, in world units. */
  x: number;
  y: number;
};

export type GraphEdge = {
  /** The prerequisite's tag. */
  from: string;
  /** The tag of the skill it unlocks. */
  to: string;
  /** The level `from` must reach. */
  level: number;
  /** True when it crosses more than one tier - drawn dashed. Eight of the 102 do. */
  long: boolean;
  /** A cubic bezier, right edge of `from` to left edge of `to`, in world units. */
  path: string;
  /** Where the level label sits, in world units. */
  labelX: number;
  labelY: number;
};

export type GraphTier = {
  depth: number;
  /** `Foundations`, `One step`, `Two steps`, ... Sentence case; the CSS upper-cases it. */
  title: string;
  count: number;
  /** Left edge of the column, in world units. */
  x: number;
};

export type MagicGraph = {
  nodes: readonly GraphNode[];
  edges: readonly GraphEdge[];
  tiers: readonly GraphTier[];
  /** World size of the whole drawing. 1366 x 1100 for the shipped ruleset. */
  width: number;
  height: number;
};

/** The apprenticeship, which is a root but not a foundation - `rules/magic_apprentices`. */
const APPRENTICESHIP = "MANI";

/**
 * How a node's box is drawn.
 *
 * Read from the depth and the tag rather than off `MagicSkillNode.branch`: the branch key is about
 * which card a skill is filed under and would change the moment a branch were renamed, whereas
 * this is about what the skill *is*. It restates the rule `magicTree.ts` uses to file `MANI` under
 * its own branch, deliberately.
 */
function kindOf(tag: string, depth: number): NodeKind {
  if (depth !== 0) {
    return "skill";
  }
  return tag === APPRENTICESHIP ? "apprenticeship" : "foundation";
}

const STEPS_IN_WORDS = [
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten"
];

/**
 * What a tier is called. Depth 0 is where everything starts; the rest are counted in steps from
 * it.
 *
 * Ten words cover a ruleset far deeper than any real one. The numeral past that is not decoration:
 * a scraped ruleset must never be able to crash the view for want of a word.
 */
function tierTitle(depth: number): string {
  if (depth === 0) {
    return "Foundations";
  }
  const word = STEPS_IN_WORDS[depth - 1];
  return word === undefined ? `${depth} steps` : `${word} ${depth === 1 ? "step" : "steps"}`;
}

/** How an edge is named in `lineageOf`'s set and in its test id: `${from}>${to}`. */
export function edgeKey(from: string, to: string): string {
  return `${from}>${to}`;
}

/** Two decimals, so an attribute only changes when the layout does. */
function round(value: number): string {
  return value.toFixed(2);
}

/**
 * `wanted` placed in the order it was given, at least `ROW_PITCH` apart, as close to `wanted` as
 * that allows.
 *
 * `wanted` must already be ascending in the order the column is to be drawn. This is isotonic
 * regression by pool-adjacent-violators over `wanted[i] - i * ROW_PITCH`: it minimises the total
 * squared distance from where each box wanted to be, subject to the boxes not overlapping. A
 * simpler "push the next one down if it collides" pass would shove a whole run of boxes below where
 * any of them wanted to be, every time the first of the run was crowded.
 */
export function settle(wanted: readonly number[]): number[] {
  const blocks: { total: number; count: number; mean: number }[] = [];
  wanted.forEach((value, index) => {
    blocks.push({ total: value - index * ROW_PITCH, count: 1, mean: value - index * ROW_PITCH });
    while (blocks.length > 1 && blocks[blocks.length - 2].mean > blocks[blocks.length - 1].mean) {
      const upper = blocks.pop()!;
      const lower = blocks.pop()!;
      const merged = { total: lower.total + upper.total, count: lower.count + upper.count, mean: 0 };
      merged.mean = merged.total / merged.count;
      blocks.push(merged);
    }
  });
  const placed: number[] = [];
  for (const block of blocks) {
    for (let index = 0; index < block.count; index += 1) {
      placed.push(block.mean + placed.length * ROW_PITCH);
    }
  }
  return placed;
}

/**
 * Where every skill sits inside its own tier.
 *
 * Sets `node.y` on every node of `columns` and returns each column re-ordered top to bottom. The
 * topmost box in the whole drawing ends at y = 0; `buildMagicGraph` adds `PAD_TOP`.
 *
 * The ordinary barycentre sweep a layered drawing does, with the coordinates carried through it
 * rather than thrown away between passes: a skill wants to sit at the mean height of its
 * neighbours, and `settle` is what turns a column of wants into a column of seats.
 *
 * The sweep counts were chosen by measurement: the layout has converged by then, and it is the
 * setting with the least total vertical line-length of any tried.
 */
function seatColumns(
  columns: readonly (readonly GraphNode[])[],
  standsOn: ReadonlyMap<string, readonly string[]>,
  carries: ReadonlyMap<string, readonly string[]>
): GraphNode[][] {
  // Nothing pulls a skill with neither a prerequisite nor a dependent, so it would simply keep
  // whatever seed it started from - which is arbitrary and visible. It is set aside and pinned at
  // the foot of its own column instead. In the shipped ruleset that is `MANI` alone.
  const isLoose = (node: GraphNode) =>
    (standsOn.get(node.tag) ?? []).length === 0 && (carries.get(node.tag) ?? []).length === 0;
  const byName = (left: GraphNode, right: GraphNode) => left.name.localeCompare(right.name);

  const connected = columns.map((column) => [...column].filter((node) => !isLoose(node)).sort(byName));
  const loose = columns.map((column) => [...column].filter(isLoose).sort(byName));

  connected.forEach((column) => {
    column.forEach((node, index) => {
      node.y = index * ROW_PITCH;
    });
  });

  const at = new Map<string, GraphNode>();
  for (const column of connected) {
    for (const node of column) {
      at.set(node.tag, node);
    }
  }

  // One pass over one column. `y` is read live rather than from a snapshot taken at the start of
  // the sweep: a column must see what the column before it in this sweep just did. That is what a
  // Sugiyama sweep is.
  const sweepColumn = (column: GraphNode[], referencesOf: (tag: string) => readonly string[]) => {
    const wantedOf = new Map<string, number>();
    for (const node of column) {
      const heights = referencesOf(node.tag)
        .map((tag) => at.get(tag)?.y)
        .filter((y): y is number => y !== undefined);
      wantedOf.set(
        node.tag,
        heights.length === 0 ? node.y : heights.reduce((sum, y) => sum + y, 0) / heights.length
      );
    }
    column.sort((left, right) => {
      const difference = wantedOf.get(left.tag)! - wantedOf.get(right.tag)!;
      return difference !== 0 ? difference : byName(left, right);
    });
    const placed = settle(column.map((node) => wantedOf.get(node.tag)!));
    column.forEach((node, index) => {
      node.y = placed[index];
    });
  };

  for (let sweep = 0; sweep < ALTERNATING_SWEEPS; sweep += 1) {
    const fromPrerequisites = sweep % 2 === 0;
    const order = fromPrerequisites ? connected : [...connected].reverse();
    for (const column of order) {
      sweepColumn(column, (tag) => (fromPrerequisites ? standsOn.get(tag) : carries.get(tag)) ?? []);
    }
  }
  for (let sweep = 0; sweep < SETTLING_SWEEPS; sweep += 1) {
    for (const column of connected) {
      sweepColumn(column, (tag) => [...(standsOn.get(tag) ?? []), ...(carries.get(tag) ?? [])]);
    }
  }

  const normalise = (all: readonly GraphNode[]) => {
    if (all.length === 0) {
      return;
    }
    const top = Math.min(...all.map((node) => node.y));
    for (const node of all) {
      node.y -= top;
    }
  };
  normalise(connected.flat());

  const seated = connected.map((column, index) => {
    const tail = loose[index];
    const lowest = column.length === 0 ? undefined : Math.max(...column.map((node) => node.y));
    tail.forEach((node, rank) => {
      // One blank row of clear air under the column, then a row each.
      node.y = lowest === undefined ? rank * ROW_PITCH : lowest + (rank + 2) * ROW_PITCH;
    });
    return [...column, ...tail];
  });

  // Whole world units, so the markup never carries a `470.40000000000003`. Rounding two boxes that
  // were exactly `ROW_PITCH` apart can bring them a unit closer, so the separation is re-enforced
  // afterwards rather than trusted.
  for (const column of seated) {
    let previous: number | undefined;
    for (const node of column) {
      const y = previous === undefined ? Math.round(node.y) : Math.max(Math.round(node.y), previous + ROW_PITCH);
      node.y = y;
      previous = y;
    }
  }
  normalise(seated.flat());

  return seated;
}

/**
 * The layered drawing of `tree`.
 *
 * Returns an empty graph - no nodes, no tiers, zero size - for a tree with no branches, which is
 * what `buildMagicTree` returns for a ruleset scraped before `magic` was added. Never throws.
 */
export function buildMagicGraph(tree: MagicTree): MagicGraph {
  const byDepth = new Map<number, GraphNode[]>();
  for (const skill of tree.byTag.values()) {
    const column = byDepth.get(skill.depth) ?? [];
    column.push({
      tag: skill.tag,
      name: skill.name,
      id: skill.id,
      depth: skill.depth,
      kind: kindOf(skill.tag, skill.depth),
      // Placed below, by `seatColumns`: a box slides freely down its column towards what it
      // stands on and what stands on it, so `y` is no longer a whole number of rows from the top.
      x: 0,
      y: 0
    });
    byDepth.set(skill.depth, column);
  }

  const depths = [...byDepth.keys()].sort((left, right) => left - right);

  // Which skill stands on which, built from `tree` and from tags alone, **before** anything is
  // seated. The edge loop below reads coordinates off `at` and so has to run after the seating;
  // this has to run before it, or the seating would be pulling boxes towards where they used to
  // be. `within` concatenated with `crossing` for the reason the edge loop gives.
  const standsOn = new Map<string, string[]>();
  const carries = new Map<string, string[]>();
  for (const skill of tree.byTag.values()) {
    const needs = [...skill.within, ...skill.crossing]
      .map((need) => need.tag)
      .filter((tag) => tree.byTag.has(tag));
    standsOn.set(skill.tag, needs);
    for (const tag of needs) {
      carries.set(tag, [...(carries.get(tag) ?? []), skill.tag]);
    }
  }

  const seated = seatColumns(
    depths.map((depth) => byDepth.get(depth) ?? []),
    standsOn,
    carries
  );

  const nodes: GraphNode[] = [];
  const tiers: GraphTier[] = [];

  depths.forEach((depth, tier) => {
    const column = seated[tier];
    // The tier's own index rather than its depth, so a ruleset with a gap in its depths - one
    // nothing in the shipped data produces, but a scrape could - draws no empty column.
    const x = PAD_LEFT + tier * TIER_PITCH;
    for (const node of column) {
      node.x = x;
      node.y = PAD_TOP + node.y;
      nodes.push(node);
    }
    tiers.push({ depth, title: tierTitle(depth), count: column.length, x });
  });

  const at = new Map(nodes.map((node) => [node.tag, node]));
  const edges: GraphEdge[] = [];
  for (const skill of tree.byTag.values()) {
    const to = at.get(skill.tag);
    if (to === undefined) {
      continue;
    }
    // `within` concatenated with `crossing` is the whole prerequisite list: `magicTree.ts` never
    // exposes the raw one, and reading either list alone silently drops edges - every depth-1
    // skill's foundations are filed under `within` on purpose.
    for (const need of [...skill.within, ...skill.crossing]) {
      const from = at.get(need.tag);
      if (from === undefined) {
        continue;
      }
      const x1 = from.x + NODE_WIDTH;
      const y1 = from.y + NODE_HEIGHT / 2;
      const x2 = to.x;
      const y2 = to.y + NODE_HEIGHT / 2;
      const mx = (x1 + x2) / 2;
      edges.push({
        from: from.tag,
        to: to.tag,
        level: need.level,
        long: to.depth - from.depth > 1,
        path: `M ${round(x1)} ${round(y1)} C ${round(mx)} ${round(y1)} ${round(mx)} ${round(y2)} ${round(x2)} ${round(y2)}`,
        labelX: x2 - 12,
        labelY: y2 - 2
      });
    }
  }

  return {
    nodes,
    edges,
    tiers,
    width: tiers.length === 0 ? 0 : PAD_LEFT + tiers.length * TIER_PITCH,
    // The real extent rather than a count of rows: a column no longer packs from the top, and the
    // old formula counted a trailing gap that is not there.
    height:
      nodes.length === 0
        ? 0
        : Math.max(...nodes.map((node) => node.y + NODE_HEIGHT)) + PAD_BOTTOM
  };
}

/**
 * Every skill and every edge on every path from `tag` back to a root, `tag` itself included.
 *
 * A depth-first walk over the incoming edges, memoised by the visited set. It is a DAG, so a skill
 * reached by two paths is visited once and **both** its edges are kept - which is the whole point:
 * `create ring of invisibility` stands on artifact lore and invisibility at once, and a walk that
 * kept only the first path would draw half its lineage.
 *
 * An unknown tag lights nothing, rather than throwing: a stale highlight naming a skill a refreshed
 * ruleset no longer holds must leave the picture readable.
 */
export function lineageOf(
  graph: MagicGraph,
  tag: string
): { skills: ReadonlySet<string>; edges: ReadonlySet<string> } {
  const skills = new Set<string>();
  const edges = new Set<string>();
  if (!graph.nodes.some((node) => node.tag === tag)) {
    return { skills, edges };
  }

  const incoming = new Map<string, GraphEdge[]>();
  for (const edge of graph.edges) {
    const list = incoming.get(edge.to) ?? [];
    list.push(edge);
    incoming.set(edge.to, list);
  }

  const walk = (current: string) => {
    if (skills.has(current)) {
      return;
    }
    skills.add(current);
    for (const edge of incoming.get(current) ?? []) {
      edges.add(edgeKey(edge.from, edge.to));
      walk(edge.from);
    }
  };
  walk(tag);

  return { skills, edges };
}

function clampStep(step: number): number {
  return Math.min(MAX_STEP, Math.max(MIN_STEP, step));
}

/**
 * The whole graph fitted into a box of screen pixels, at a whole zoom step.
 *
 * Floored to a whole step for the reason `mapViewport`'s `fitTo` gives: a fractional scale is one
 * zooming cannot return to, and rounding up clips the outermost node off the edge. At the graph
 * dialog's real size this lands on step -3, scale 0.5946 - the view always opens in the `tags`
 * band, which is what `labelBand` is drawn to expect.
 *
 * A box with no size, or a graph with nothing in it, fits at the origin rather than at a scale
 * derived from a division by zero.
 */
export function fitGraph(graph: MagicGraph, width: number, height: number): Viewport {
  if (graph.width <= 0 || graph.height <= 0 || width <= 0 || height <= 0) {
    return { tx: 0, ty: 0, step: 0 };
  }
  const wanted = Math.min(width / graph.width, height / graph.height);
  const step = clampStep(Math.floor(Math.log2(wanted) * STEPS_PER_DOUBLING));
  const scale = scaleOf(step);
  return {
    tx: width / 2 - (graph.width / 2) * scale,
    ty: height / 2 - (graph.height / 2) * scale,
    step
  };
}

/** `node` brought to the middle of a box of screen pixels, keeping `viewport`'s zoom. */
export function centreNode(
  node: GraphNode,
  viewport: Viewport,
  width: number,
  height: number
): Viewport {
  const scale = scaleOf(viewport.step);
  return {
    tx: width / 2 - (node.x + NODE_WIDTH / 2) * scale,
    ty: height / 2 - (node.y + NODE_HEIGHT / 2) * scale,
    step: viewport.step
  };
}

/** What a node's box can carry at a given zoom. */
export type LabelBand = "names" | "tags" | "none";

/** scaleOf(-1) = 0.841, so a 10.5px name still renders at 8.8px - the last step it is readable. */
const FIRST_NAMES_STEP = -1;
/** scaleOf(-4) = 0.5, so an 11px box still holds a 10px tag drawn at a constant screen size. */
const FIRST_TAGS_STEP = -4;

/**
 * What a node's box can carry at `step`.
 *
 * Keyed on the **step**, never on the scale, for the reason `zoomBand`'s doc-comment gives: a
 * jittering trackpad emits a stream of tiny deltas, and a band keyed on a continuous scale would
 * flip twice inside one gesture.
 */
export function labelBand(step: number): LabelBand {
  if (step >= FIRST_NAMES_STEP) {
    return "names";
  }
  return step >= FIRST_TAGS_STEP ? "tags" : "none";
}
