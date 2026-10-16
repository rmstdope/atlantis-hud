import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PaletteEntry } from "../commandPalette";
import { CommandPalette, kindLabel, PaletteNoteText } from "./CommandPalette";

/**
 * How a row reads. Static markup only - `packages/shared` has no jsdom (ah-nass), so what the
 * palette lists and in which order is pinned in `commandPalette.test.ts`, and choosing a row in
 * `tests/smoke/shortcuts.spec.ts`.
 */
const noop = () => {};

const draw = (entries: PaletteEntry[]) =>
  renderToStaticMarkup(<CommandPalette entries={entries} onDismiss={noop} />);

/** The markup of the one row whose label is `label`. */
function rowOf(markup: string, label: string): string {
  const rows = markup.split('<li role="presentation">').slice(1);
  const row = rows.find((candidate) => candidate.includes(`>${label}<`));
  expect(row, `no row labelled ${label}`).toBeDefined();
  return row ?? "";
}

const own: PaletteEntry = { id: "unit-518", kind: "unit", label: "Wardrobe Guard (518)", run: noop };
const named: PaletteEntry = {
  id: "foreign-unit-1:18,52-2207",
  kind: "unit",
  label: "Wardens of the Vale (2207)",
  faction: { label: "Thane's Ring (10)", concealed: false },
  run: noop
};
const hidden: PaletteEntry = {
  id: "foreign-unit-1:18,52-3110",
  kind: "unit",
  label: "Ward Scouts (3110)",
  faction: { label: "Faction not shown", concealed: true },
  run: noop
};
const remembered: PaletteEntry = {
  id: "stale-unit-1:9,9-1904",
  kind: "unit",
  label: "Warden Barge (1904)",
  lastSeenTurn: 42,
  run: noop
};

describe("a palette row for another faction's unit (ah-mlls.1)", () => {
  it("names the faction just before the kind", () => {
    const row = rowOf(draw([named]), "Wardens of the Vale (2207)");
    const faction = row.indexOf("Thane&#x27;s Ring (10)");
    expect(faction).toBeGreaterThan(-1);
    expect(row.indexOf(">unit<")).toBeGreaterThan(faction);
  });

  it("says Faction not shown, dimmer and italic, when the owner is not disclosed", () => {
    const row = rowOf(draw([hidden]), "Ward Scouts (3110)");
    expect(row).toMatch(/<span[^>]*class="[^"]*italic[^"]*text-ink-dim[^"]*"[^>]*>Faction not shown</);
  });

  it("does not draw a named owner italic", () => {
    const row = rowOf(draw([named]), "Wardens of the Vale (2207)");
    expect(row).not.toContain("italic");
  });

  it("lets the faction shorten first, and never the kind", () => {
    const row = rowOf(draw([named]), "Wardens of the Vale (2207)");
    expect(row).toMatch(/data-testid="palette-faction"[^>]*class="[^"]*shrink-\[1000\][^"]*truncate/);
    expect(row).toMatch(/class="[^"]*shrink-0[^"]*">unit</);
  });

  it("shows the full row text on hover", () => {
    expect(rowOf(draw([named]), "Wardens of the Vale (2207)")).toContain(
      'title="Wardens of the Vale (2207) · Thane&#x27;s Ring (10) · unit"'
    );
    expect(rowOf(draw([remembered]), "Warden Barge (1904)")).toContain(
      'title="Warden Barge (1904) · last seen turn 42 · unit"'
    );
  });

  it("gives the player's own unit no faction", () => {
    expect(rowOf(draw([own]), "Wardrobe Guard (518)")).not.toContain("palette-faction");
  });
});

describe("a palette row for a faction (ah-mlls.3)", () => {
  const yours: PaletteEntry = {
    id: "faction-95",
    kind: "faction",
    label: "Borg TNG (95)",
    standing: { own: true, merged: false, attitude: null },
    run: noop
  };
  const ally: PaletteEntry = {
    id: "faction-31",
    kind: "faction",
    label: "Thornwood (31)",
    standing: { own: false, merged: true, attitude: "Ally" },
    run: noop
  };
  const earlier: PaletteEntry = {
    id: "faction-58",
    kind: "faction",
    label: "Greenhollow (58)",
    lastSeenTurn: 41,
    standing: { own: false, merged: false, attitude: "Neutral" },
    run: noop
  };
  const markup = draw([yours, ally, earlier]);

  it("draws your faction, or the attitude, just before the kind", () => {
    expect(markup).toMatch(/>your faction<\/span><span[^>]*>faction<\/span>/);
    expect(markup).toMatch(/class="[^"]*text-ok[^"]*">Ally<\/span>/);
  });

  it("marks a merged ally's name in brass with the house mark", () => {
    expect(markup).toMatch(/class="[^"]*text-brass-bright[^"]*">Thornwood \(31\) ⌂</);
  });

  it("dates an earlier-turn faction ahead of its attitude, which never shortens", () => {
    expect(markup).toMatch(/last seen turn 41<\/span><span class="shrink-0[^"]*">Neutral<\/span>/);
  });

  it("shows the full row text on hover", () => {
    expect(markup).toContain('title="Greenhollow (58) · last seen turn 41 · Neutral · faction"');
    expect(markup).toContain('title="Thornwood (31) ⌂ · Ally · faction"');
  });
});

describe("an Army row in the palette (ah-mlls.4)", () => {
  const iron: PaletteEntry = {
    id: "army-a1",
    kind: "army",
    label: "Iron Guard",
    count: { text: "5 units", quiet: false },
    run: noop
  };
  const watch: PaletteEntry = {
    id: "army-a3",
    kind: "army",
    label: "Old Watch",
    count: { text: "no units this turn", quiet: true },
    run: noop
  };

  it("draws its name, then its count, then the kind word", () => {
    const row = rowOf(draw([iron]), "Iron Guard");
    const count = row.indexOf(">5 units<");
    expect(count).toBeGreaterThan(-1);
    expect(row.indexOf(">army<")).toBeGreaterThan(count);
  });

  it("never lets the count shorten", () => {
    expect(rowOf(draw([iron]), "Iron Guard")).toMatch(/class="[^"]*shrink-0[^"]*">5 units</);
  });

  it("shows its full text on hover", () => {
    expect(rowOf(draw([iron]), "Iron Guard")).toContain('title="Iron Guard · 5 units · army"');
  });

  it("draws an empty count dim and in italics, and a full one plain", () => {
    expect(rowOf(draw([watch]), "Old Watch")).toMatch(
      /<span[^>]*class="[^"]*italic[^"]*text-ink-dim[^"]*"[^>]*>no units this turn</
    );
    expect(rowOf(draw([iron]), "Iron Guard")).not.toContain("italic");
  });
});

describe("a palette row for a note (ah-mlls.5)", () => {
  const hexNote: PaletteEntry = {
    id: "hex-note-n1",
    kind: "hex-note",
    label: "Scouted turn 61.\nA seam of iron under the ridge.",
    note: { place: "hill (3,29) in Grey Reach · turn 61" },
    run: noop
  };
  const far: PaletteEntry = {
    id: "mage-note-95/2214",
    kind: "mage-note",
    label: "Needs FIRE 3 before the long winter siege, then switch her to iron-working?",
    note: { place: "Ulla the Grey (2214) · study planner" },
    run: noop
  };
  const text = (entry: PaletteEntry, query: string) =>
    renderToStaticMarkup(
      <PaletteNoteText text={entry.label} place={entry.note?.place ?? ""} query={query} />
    );

  it("draws the line holding the match, the match in bold", () => {
    const markup = text(hexNote, "iron");
    expect(markup).toContain("A seam of <b");
    expect(markup).toMatch(/<b[^>]*>iron<\/b> under the ridge\./);
    expect(markup).not.toContain("Scouted");
  });

  it("starts a far match's line with an ellipsis", () => {
    expect(text(far, "iron")).toContain("…then switch her to <b");
  });

  it("puts the place beneath, dimmed", () => {
    expect(text(hexNote, "iron")).toMatch(
      /class="[^"]*text-ink-dim[^"]*"[^>]*>hill \(3,29\) in Grey Reach · turn 61</
    );
  });

  it("says hex note and mage note as the kind words", () => {
    expect(kindLabel(hexNote)).toBe("hex note");
    expect(kindLabel(far)).toBe("mage note");
    expect(kindLabel(own)).toBe("unit");
  });
});
