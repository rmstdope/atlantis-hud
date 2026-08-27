import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { readRuleset } from "@atlantis/fixtures";
import { aReportUnit, type SkillInfo } from "@atlantis/core-client";
import { parseGameData, type GameDataIndex } from "../gameData";
import { buildMagicTree } from "../magicTree";
import { standingOf } from "../magicStanding";
import { buildMagicGraph } from "./magicGraphLayout";
import { findByTestId } from "../testing/elementTree";
import { MagicGraphDrawing } from "./MagicGraphView";

const index = parseGameData(readRuleset());
if (index === null) {
  throw new Error("the shipped ruleset did not parse; every assertion below is about its contents");
}
const tree = buildMagicTree(index);
const graph = buildMagicGraph(tree);

const held = (levels: Record<string, number>): SkillInfo[] =>
  Object.entries(levels).map(([tag, level]) => ({
    name: tag.toLowerCase(),
    tag,
    level,
    points: level * 30
  }));

/** Six of Seven (881) of the smoke fixture `g7f95t71`, verbatim. */
const SIX_OF_SEVEN = standingOf(
  aReportUnit({
    unitId: "881",
    name: "Six of Seven",
    skills: held({
      FORC: 4, PATT: 3, SPIR: 3, GATE: 1, FIRE: 2, ILLU: 3, PHEN: 1, EART: 3, BIRD: 3,
      TRUE: 2, WOLF: 3, DRAG: 3, PHDE: 3, ARTI: 2, EARM: 2, WEAT: 3, STOR: 3
    })
  }),
  tree,
  index as GameDataIndex
);

/** Just the one skill's group, so an assertion cannot pass on a neighbour's markup. */
const node = (html: string, tag: string) => {
  const from = html.indexOf(`data-testid="magic-graph-skill-${tag}"`);
  const rest = html.slice(from);
  const next = rest.indexOf('data-testid="magic-graph-skill-', 1);
  return next === -1 ? rest : rest.slice(0, next);
};

/**
 * `MagicGraphDrawing` rather than `MagicGraphView`: the view owns the gestures and therefore the
 * hooks, and this package has no jsdom (ah-nass), so a static render would run none of them and
 * `findByTestId` could not enter it. The drawing is the hook-free half - the same split
 * `MeasuredFactionDossier` makes beside `FactionDossierPanel`.
 */
const drawing = (lit: string | null = null) => (
  <MagicGraphDrawing graph={graph} lit={lit} viewport={null} onLight={() => {}} onOpenGameData={() => {}} />
);

const occurrences = (html: string, needle: string) => html.split(needle).length - 1;

describe("MagicGraphDrawing", () => {
  it("draws every skill, every edge and every tier heading", () => {
    const html = renderToStaticMarkup(drawing());

    expect(occurrences(html, 'data-testid="magic-graph-skill-')).toBe(70);
    expect(occurrences(html, 'data-testid="magic-graph-edge-')).toBe(102);
    expect(occurrences(html, 'data-testid="magic-graph-tier-')).toBe(5);
    expect(html).toContain("Foundations");
    expect(html).toContain("Four steps");
    expect(html).toContain("38 skills");

    // A static render runs no effects, so nothing has measured or fitted: the world sits at the
    // origin, unscaled, and the names band is what an unscaled box can carry.
    expect(html).toContain("translate(0.00,0.00) scale(1.0000)");
    expect(html).toContain("create ring of invisibility");
  });

  it("dims everything outside the lit lineage", () => {
    const html = renderToStaticMarkup(drawing("CRRI"));

    const group = (testId: string) => {
      const at = html.indexOf(`data-testid="${testId}"`);
      expect(at).toBeGreaterThan(-1);
      return html.slice(html.lastIndexOf("<", at), html.indexOf(">", at) + 1);
    };

    // Artifact lore is on the way back from CRRI to the foundations; fire is not on any path.
    expect(group("magic-graph-skill-ARTI")).not.toContain("opacity-[0.22]");
    expect(group("magic-graph-skill-FIRE")).toContain("opacity-[0.22]");
    // Nothing is dimmed at all while nothing is lit.
    expect(renderToStaticMarkup(drawing())).not.toContain("opacity-[0.22]");

    expect(html).toContain('data-testid="magic-graph-edge-ILLU-INVI"');
    const litEdge = html.slice(html.indexOf('data-testid="magic-graph-edge-ILLU-INVI"'));
    expect(litEdge.slice(0, 400)).toContain("stroke-brass");
    const unlitEdge = html.slice(html.indexOf('data-testid="magic-graph-edge-FORC-FIRE"'));
    expect(unlitEdge.slice(0, 400)).toContain("opacity-[0.13]");
  });

  it("opens the dictionary on a second click on the lit skill", () => {
    const lightings: (string | null)[] = [];
    const opened: string[] = [];
    const tree = (
      <MagicGraphDrawing
        graph={graph}
        lit="CRRI"
        viewport={null}
        onLight={(tag) => lightings.push(tag)}
        onOpenGameData={(entryId) => opened.push(entryId)}
      />
    );

    (findByTestId(tree, "magic-graph-skill-CRRI").props.onClick as () => void)();
    expect(opened).toEqual(["skill:CRRI"]);
    expect(lightings).toEqual([]);

    (findByTestId(tree, "magic-graph-skill-FIRE").props.onClick as () => void)();
    expect(lightings).toEqual(["FIRE"]);
    expect(opened).toEqual(["skill:CRRI"]);
  });
});

describe("tinting the graph for one mage", () => {
  const tinted = (step: number) =>
    renderToStaticMarkup(
      <MagicGraphDrawing
        graph={graph}
        lit={null}
        viewport={{ tx: 0, ty: 0, step }}
        standing={SIX_OF_SEVEN.byTag}
        onLight={() => {}}
        onOpenGameData={() => {}}
      />
    );

  it("bars each node with where the mage stands", () => {
    const html = tinted(0);

    expect(node(html, "FORC")).toContain('data-testid="magic-graph-bar-FORC"');
    expect(node(html, "FORC")).toContain("stroke-ok");
    expect(node(html, "ILLU")).toContain("stroke-warn");
    expect(node(html, "INVI")).toContain("stroke-select");
    // Locked takes no bar at all: it is the absence of a state, not a fifth pattern.
    expect(node(html, "CRRI")).not.toContain('data-testid="magic-graph-bar-CRRI"');
  });

  it("marks the level only where the names fit", () => {
    const names = tinted(0);
    expect(node(names, "FORC")).toContain("4→5");
    expect(node(names, "ILLU")).toContain("3▲");
    expect(node(names, "INVI")).toContain("○");
    expect(node(names, "CRRI")).not.toContain('data-testid="magic-graph-mark-CRRI"');

    // The view opens at step -3, where a mark would be about six pixels: the bar is drawn there
    // and the mark is not.
    const tags = tinted(-2);
    expect(node(tags, "FORC")).toContain('data-testid="magic-graph-bar-FORC"');
    expect(node(tags, "FORC")).not.toContain('data-testid="magic-graph-mark-FORC"');
    expect(tags).not.toContain("4→5");
  });

  it("draws nothing extra with no mage picked", () => {
    const html = renderToStaticMarkup(drawing());

    expect(html).not.toContain('data-testid="magic-graph-bar-');
    expect(html).not.toContain('data-testid="magic-graph-mark-');
  });
});
