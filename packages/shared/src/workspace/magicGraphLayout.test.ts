import { describe, expect, it } from "vitest";
import { readRuleset } from "@atlantis/fixtures";
import { parseGameData } from "../gameData";
import { buildMagicTree, type MagicTree } from "../magicTree";
import {
  buildMagicGraph,
  centreNode,
  edgeKey,
  fitGraph,
  labelBand,
  lineageOf,
  NODE_HEIGHT,
  NODE_WIDTH,
  settle
} from "./magicGraphLayout";
import { scaleOf } from "./mapViewport";

/**
 * Built over the **real shipped ruleset**, because every number worth pinning here - 70 skills, 102
 * edges, the tier counts, the `CRRI` lineage - is a fact about the real data. A miniature fixture
 * would pin arithmetic that has no bugs in it and say nothing about the picture a reader sees.
 */
const index = parseGameData(readRuleset());
if (index === null) {
  throw new Error("the shipped ruleset did not parse; every assertion below is about its contents");
}
const tree = buildMagicTree(index);
const graph = buildMagicGraph(tree);

describe("buildMagicGraph", () => {
  it("lays every magic skill out in its tier", () => {
    expect(graph.nodes.length).toBe(70);
    expect(graph.tiers.length).toBe(5);
    expect(graph.tiers.map((tier) => tier.count)).toEqual([4, 15, 38, 11, 2]);
    expect(graph.tiers.map((tier) => tier.depth)).toEqual([0, 1, 2, 3, 4]);

    // Nothing is drawn on top of anything else - the one property a layout must have.
    const seats = new Set(graph.nodes.map((node) => `${node.x},${node.y}`));
    expect(seats.size).toBe(graph.nodes.length);

    // A tier is a column: every node in it shares the tier's left edge.
    for (const tier of graph.tiers) {
      const column = graph.nodes.filter((node) => node.depth === tier.depth);
      expect(column.length).toBe(tier.count);
      expect(column.every((node) => node.x === tier.x)).toBe(true);
    }

    expect(graph.width).toBe(1366);
    expect(graph.height).toBe(1100);
  });

  it("names the tiers and sets MANI apart", () => {
    expect(graph.tiers.map((tier) => tier.title)).toEqual([
      "Foundations",
      "One step",
      "Two steps",
      "Three steps",
      "Four steps"
    ]);

    const kindOf = (tag: string) => graph.nodes.find((node) => node.tag === tag)?.kind;
    expect(kindOf("FORC")).toBe("foundation");
    expect(kindOf("PATT")).toBe("foundation");
    expect(kindOf("SPIR")).toBe("foundation");
    // Not a foundation: `rules/magic_apprentices` - manipulation makes an apprentice, not a mage.
    expect(kindOf("MANI")).toBe("apprenticeship");
    expect(kindOf("CRRI")).toBe("skill");
  });

  it("draws an edge for every prerequisite, carrying its level", () => {
    expect(graph.edges.length).toBe(102);

    const edge = (from: string, to: string) =>
      graph.edges.find((candidate) => candidate.from === from && candidate.to === to);
    // `data/CRRI`: create ring of invisibility needs artifact lore 2 and invisibility 3.
    expect(edge("ARTI", "CRRI")?.level).toBe(2);
    expect(edge("INVI", "CRRI")?.level).toBe(3);

    // Every line leaves the right edge of the box it comes from, at its middle.
    const at = new Map(graph.nodes.map((node) => [node.tag, node]));
    for (const line of graph.edges) {
      const from = at.get(line.from);
      expect(from).toBeDefined();
      const x1 = (from!.x + NODE_WIDTH).toFixed(2);
      const y1 = (from!.y + NODE_HEIGHT / 2).toFixed(2);
      expect(line.path.startsWith(`M ${x1} ${y1} C `)).toBe(true);
    }
  });

  it("marks an edge that crosses more than one tier", () => {
    const travelling = graph.edges.filter((line) => line.long);

    expect(travelling.length).toBe(8);
    expect(new Set(travelling.map((line) => line.from))).toEqual(new Set(["ARTI"]));
  });

  it("lights every path back to a root", () => {
    const lineage = lineageOf(graph, "CRRI");

    expect(lineage.skills).toEqual(
      new Set(["CRRI", "ARTI", "INVI", "ILLU", "FORC", "PATT", "SPIR"])
    );
    expect(lineage.edges).toEqual(
      new Set([
        edgeKey("ARTI", "CRRI"),
        edgeKey("FORC", "ARTI"),
        edgeKey("FORC", "ILLU"),
        edgeKey("ILLU", "INVI"),
        edgeKey("INVI", "CRRI"),
        edgeKey("PATT", "ARTI"),
        edgeKey("PATT", "ILLU"),
        edgeKey("SPIR", "ARTI")
      ])
    );

    // A foundation stands on nothing, so it lights only itself.
    const root = lineageOf(graph, "FORC");
    expect(root.skills).toEqual(new Set(["FORC"]));
    expect(root.edges.size).toBe(0);
  });

  it("fits the whole graph at a whole zoom step", () => {
    // The graph dialog's real size at a normal window: 94vw x 80vh, less the header strips.
    const fitted = fitGraph(graph, 1464, 743);

    expect(fitted.step).toBe(-3);
    expect(graph.width * scaleOf(fitted.step)).toBeLessThanOrEqual(1464);
    expect(graph.height * scaleOf(fitted.step)).toBeLessThanOrEqual(743);
    // The drawing's centre lands on the box's centre.
    expect(fitted.tx + (graph.width / 2) * scaleOf(fitted.step)).toBeCloseTo(732, 6);
    expect(fitted.ty + (graph.height / 2) * scaleOf(fitted.step)).toBeCloseTo(371.5, 6);
    // Fitting twice at the same size is the same view - a fit a reader cannot get back to is the
    // bug `mapViewport`'s own `fitTo` was floored to a whole step to refuse.
    expect(fitGraph(graph, 1464, 743)).toEqual(fitted);
  });

  it("keeps the zoom when centring a node", () => {
    const node = graph.nodes.find((candidate) => candidate.tag === "CRRI");
    expect(node).toBeDefined();
    const view = { tx: 12, ty: -40, step: 1 };

    const centred = centreNode(node!, view, 800, 600);

    expect(centred.step).toBe(1);
    const scale = scaleOf(1);
    expect(centred.tx + (node!.x + NODE_WIDTH / 2) * scale).toBeCloseTo(400, 6);
    expect(centred.ty + (node!.y + NODE_HEIGHT / 2) * scale).toBeCloseTo(300, 6);
  });

  it("drops the names before the tags", () => {
    expect(labelBand(0)).toBe("names");
    expect(labelBand(-1)).toBe("names");
    expect(labelBand(-2)).toBe("tags");
    expect(labelBand(-4)).toBe("tags");
    expect(labelBand(-5)).toBe("none");
  });

  it("draws nothing for a ruleset with no magic skills", () => {
    const empty: MagicTree = { branches: [], byTag: new Map(), skillCount: 0 };
    const drawn = buildMagicGraph(empty);

    expect(drawn.nodes).toEqual([]);
    expect(drawn.edges).toEqual([]);
    expect(drawn.tiers).toEqual([]);
    expect(drawn.width).toBe(0);
    expect(drawn.height).toBe(0);
  });
});

describe("settle", () => {
  it("spaces a column out without pushing it further than it has to", () => {
    expect(settle([])).toEqual([]);
    expect(settle([100])).toEqual([100]);
    // Already a row apart: nothing moves.
    expect(settle([0, 27, 54])).toEqual([0, 27, 54]);
    // Three skills all wanting the same height end up centred on it, not pushed down from the first.
    expect(settle([100, 100, 100])).toEqual([73, 100, 127]);
    // A crowded pair opens around its own middle; the one below it was already clear and stays.
    expect(settle([0, 10, 400])).toEqual([-8.5, 18.5, 400]);
  });
});
