import { describe, expect, it } from "vitest";
import type { PaletteEntry } from "../commandPalette";
import { factionRow } from "./paletteFactionRow";

function entry(standing: NonNullable<PaletteEntry["standing"]>, lastSeenTurn?: number): PaletteEntry {
  return {
    id: "faction-10",
    kind: "faction",
    label: "Thane's Ring (10)",
    standing,
    ...(lastSeenTurn === undefined ? {} : { lastSeenTurn }),
    run: () => {}
  };
}

describe("factionRow", () => {
  it("draws Ally green and Hostile red, in the report's own word", () => {
    expect(factionRow(entry({ own: false, merged: false, attitude: "Ally" })).attitude).toEqual({
      word: "Ally",
      className: "text-ok"
    });
    expect(factionRow(entry({ own: false, merged: false, attitude: "hostile" })).attitude).toEqual({
      word: "hostile",
      className: "text-danger"
    });
  });

  it("draws every other attitude plainly", () => {
    for (const word of ["Friendly", "Neutral", "Unfriendly"]) {
      expect(factionRow(entry({ own: false, merged: false, attitude: word })).attitude).toEqual({
        word,
        className: "text-ink-soft"
      });
    }
  });

  it("says not declared, dim and italic, when nothing is declared", () => {
    expect(factionRow(entry({ own: false, merged: false, attitude: null })).attitude).toEqual({
      word: "not declared",
      className: "text-ink-dim italic"
    });
  });

  it("says your faction, in brass, for the player's own", () => {
    expect(factionRow(entry({ own: true, merged: false, attitude: null })).attitude).toEqual({
      word: "your faction",
      className: "text-brass"
    });
  });

  it("marks a merged ally's name in brass with the house mark", () => {
    const row = factionRow(entry({ own: false, merged: true, attitude: "Ally" }));
    expect(row.mark).toBe(" ⌂");
    expect(row.labelClassName).toBe("text-brass-bright");
    expect(factionRow(entry({ own: false, merged: false, attitude: "Ally" })).mark).toBe("");
  });
});
