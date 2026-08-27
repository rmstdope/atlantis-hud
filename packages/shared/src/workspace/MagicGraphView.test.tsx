import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { readRuleset } from "@atlantis/fixtures";
import { parseGameData } from "../gameData";
import { buildMagicTree } from "../magicTree";
import { buildMagicGraph } from "./magicGraphLayout";
import { findByTestId } from "../testing/elementTree";
import { MagicGraphDrawing } from "./MagicGraphView";

const index = parseGameData(readRuleset());
if (index === null) {
  throw new Error("the shipped ruleset did not parse; every assertion below is about its contents");
}
const graph = buildMagicGraph(buildMagicTree(index));

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
