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
      // Placed below, once the column is sorted: a seat is an index within its own tier.
      x: 0,
      y: 0
    });
    byDepth.set(skill.depth, column);
  }

  const depths = [...byDepth.keys()].sort((left, right) => left - right);
  const nodes: GraphNode[] = [];
  const tiers: GraphTier[] = [];
  let tallest = 0;

  depths.forEach((depth, tier) => {
    const column = (byDepth.get(depth) ?? []).sort((left, right) =>
      left.name.localeCompare(right.name)
    );
    // The tier's own index rather than its depth, so a ruleset with a gap in its depths - one
    // nothing in the shipped data produces, but a scrape could - draws no empty column.
    const x = PAD_LEFT + tier * TIER_PITCH;
    column.forEach((node, rank) => {
      node.x = x;
      node.y = PAD_TOP + rank * (NODE_HEIGHT + NODE_GAP);
      nodes.push(node);
    });
    tiers.push({ depth, title: tierTitle(depth), count: column.length, x });
    tallest = Math.max(tallest, column.length);
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
    height: tiers.length === 0 ? 0 : PAD_TOP + tallest * (NODE_HEIGHT + NODE_GAP) + PAD_BOTTOM
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
