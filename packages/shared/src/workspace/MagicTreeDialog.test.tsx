import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { readRuleset } from "@atlantis/fixtures";
import { parseGameData, type GameDataIndex } from "../gameData";
import { buildMagicTree } from "../magicTree";
import type { MagicTreeView } from "./magicGraphLayout";
import { MagicTreeDialog } from "./MagicTreeDialog";

const tree = buildMagicTree(parseGameData(readRuleset()) as GameDataIndex);

const dialog = (initialTag: string | null = null, view: MagicTreeView = "branches") => (
  <MagicTreeDialog
    tree={tree}
    initialTag={initialTag}
    view={view}
    onView={() => {}}
    graphViewport={null}
    onGraphViewport={() => {}}
    onOpenGameData={() => {}}
    onDismiss={() => {}}
  />
);

const markup = (initialTag: string | null = null, view: MagicTreeView = "branches") =>
  renderToStaticMarkup(dialog(initialTag, view));

const occurrences = (html: string, needle: string) => html.split(needle).length - 1;

describe("MagicTreeDialog", () => {
  it("draws every branch and every skill", () => {
    const html = markup();

    for (const title of [
      "The foundations",
      "Artifact lore",
      "Illusion",
      "Necromancy",
      "Weather lore",
      "Demon lore",
      "Earth lore",
      "Gate lore",
      "Straight from a foundation",
      "Apprenticeship"
    ]) {
      expect(html).toContain(title);
    }
    expect(occurrences(html, "create ring of invisibility")).toBe(1);
    expect(occurrences(html, 'data-testid="magic-tree-skill-')).toBe(70);
    expect(html).toContain("70 skills");
    expect(html).toContain("Magic study tree");
    expect(html).toContain("Close");
  });

  it("states the cap rule once, under the header", () => {
    const html = markup();

    expect(occurrences(html, "can never rise above")).toBe(1);
    expect(html).toContain(
      "A magic skill can never rise above the skills it stands on — the levels below are floors to begin, and ceilings thereafter."
    );
  });

  it("reads a within-branch gate as text and a crossing one as a chip", () => {
    const html = markup();

    // CRRI needs ARTI 2 (its own branch) and INVI 3 (illusion's).
    expect(html).toContain('data-testid="magic-tree-chip-CRRI-INVI"');
    expect(html).toContain("+INVI 3");
    expect(html).toContain('title="also needs invisibility at level 3"');
    // ARTI 2 is a gate, so it is never a chip.
    expect(html).not.toContain('data-testid="magic-tree-chip-CRRI-ARTI"');
    // A one-step skill's foundations read as gate text, not as two chips.
    expect(html).not.toContain('data-testid="magic-tree-chip-ILLU-FORC"');
  });

  it("names a skill as the door into the dictionary", () => {
    const html = markup();

    expect(html).toContain('data-testid="magic-tree-skill-FORC"');
    expect(html).toContain('data-testid="magic-tree-branch-ARTI"');
    expect(html).toContain('data-testid="magic-tree-dialog"');
    expect(html).toContain('data-testid="magic-tree-backdrop"');
    expect(html).toContain('data-testid="magic-tree-close"');
    expect(html).toContain('data-testid="magic-tree-cap"');
  });

  // The dialog opens at pt-[10vh], so its max height must leave a matching margin below
  // (ah-vwdi, as the dictionary's own test records).
  it("stops short of the bottom edge, leaving a margin matching the one above", () => {
    const html = markup();
    expect(html).toContain("max-h-[80vh]");
    expect(html).not.toContain("max-h-[80vh]!");
  });
});

describe("landing on a skill", () => {
  it("picks out the skill it was opened on", () => {
    const html = markup("INVI");

    expect(html).toMatch(/data-testid="magic-tree-skill-INVI"[^>]*class="[^"]*bg-panel/);
    expect(html).not.toMatch(/data-testid="magic-tree-skill-FORC"[^>]*class="[^"]*bg-panel/);
    expect(html).toMatch(/data-testid="magic-tree-skill-FORC"[^>]*class="[^"]*text-ink-soft/);
  });

  it("picks out nothing when it was opened at the top", () => {
    // Named on the row rather than on the class alone: the header's view toggle draws its pressed
    // half with `bg-panel` too, so a bare search for the class no longer says anything about which
    // skill is picked out.
    expect(markup()).not.toMatch(/data-testid="magic-tree-skill-[A-Z]+"[^>]*class="[^"]*bg-panel/);
  });
});

describe("the two views", () => {
  it("offers both views and marks the one showing", () => {
    const html = markup();

    expect(html).toContain('data-testid="magic-tree-view-branches"');
    expect(html).toContain('data-testid="magic-tree-view-graph"');
    // Exactly one of them is pressed, in either view.
    for (const view of ["branches", "graph"] as const) {
      expect(markup(null, view).split('aria-pressed="true"').length - 1).toBe(1);
    }

    // Clicking the toggle is not assertable here: `MagicTreeDialog` uses hooks, so `findByTestId`
    // cannot enter it and this package has no jsdom (ah-nass). `tests/smoke/magic-graph.spec.ts`
    // clicks it for real.
  });

  it("shows one view at a time", () => {
    const graphHtml = markup(null, "graph");
    expect(graphHtml).toContain('data-testid="magic-graph"');
    expect(graphHtml).not.toContain('data-testid="magic-tree-branch-ARTI"');
    expect(graphHtml).toContain("70 skills · 5 tiers");

    const branchHtml = markup(null, "branches");
    expect(branchHtml).toContain('data-testid="magic-tree-branch-ARTI"');
    expect(branchHtml).not.toContain('data-testid="magic-graph"');
  });

  // The graph needs a real height to fit into; a box that sized to its content would fit the
  // graph into whatever height the graph had just been given.
  it("opens the box out for the graph, and fixes its height", () => {
    const graphHtml = markup(null, "graph");
    expect(graphHtml).toContain("h-[80vh]");
    expect(graphHtml).toContain("w-[94vw]");
    expect(graphHtml).toContain("overflow-hidden");
  });

  it("names the lit skill and offers Show all", () => {
    const html = markup("CRRI", "graph");

    expect(html).toContain('data-testid="magic-tree-lit"');
    expect(html).toContain("create ring of invisibility");
    expect(html).toContain("click again to open in the dictionary");
    expect(html).toContain('data-testid="magic-tree-show-all"');

    const nothingLit = markup(null, "graph");
    expect(nothingLit).not.toContain('data-testid="magic-tree-lit"');
    expect(nothingLit).not.toContain('data-testid="magic-tree-show-all"');
  });

  it("offers the same zoom controls the map does, in the graph only", () => {
    const html = markup(null, "graph");

    for (const id of ["magic-tree-zoom-in", "magic-tree-zoom-out", "magic-tree-zoom-fit"]) {
      expect(html).toContain(`data-testid="${id}"`);
    }
    expect(html).toContain('aria-label="Zoom to fit"');
    expect(markup(null, "branches")).not.toContain('data-testid="magic-tree-zoom-in"');
  });
});
