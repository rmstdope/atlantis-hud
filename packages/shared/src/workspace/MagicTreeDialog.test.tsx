import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { readRuleset } from "@atlantis/fixtures";
import { parseGameData, type GameDataIndex } from "../gameData";
import { buildMagicTree } from "../magicTree";
import { MagicTreeDialog } from "./MagicTreeDialog";

const tree = buildMagicTree(parseGameData(readRuleset()) as GameDataIndex);

const markup = (initialTag: string | null = null) =>
  renderToStaticMarkup(
    <MagicTreeDialog
      tree={tree}
      initialTag={initialTag}
      onOpenGameData={() => {}}
      onDismiss={() => {}}
    />
  );

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
    expect(markup()).not.toContain("bg-panel ");
  });
});
