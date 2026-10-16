import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PaletteEntry } from "../commandPalette";
import { CommandPalette } from "./CommandPalette";

const noop = () => {};

const ENTRIES: PaletteEntry[] = [
  {
    id: "faction-95",
    kind: "faction",
    label: "Borg TNG (95)",
    faction: { own: true, merged: false, attitude: null },
    run: noop
  },
  {
    id: "faction-31",
    kind: "faction",
    label: "Thornwood (31)",
    faction: { own: false, merged: true, attitude: "Ally" },
    run: noop
  },
  {
    id: "faction-58",
    kind: "faction",
    label: "Greenhollow (58)",
    lastSeenTurn: 41,
    faction: { own: false, merged: false, attitude: "Neutral" },
    run: noop
  },
  { id: "region-1", kind: "region", label: "plain (12,34)", run: noop }
];

describe("CommandPalette faction rows (ah-mlls.3)", () => {
  const markup = renderToStaticMarkup(<CommandPalette entries={ENTRIES} onDismiss={noop} />);

  it("draws the attitude, or your faction, before the kind word", () => {
    expect(markup).toMatch(/your faction<\/span><span[^>]*>faction<\/span>/);
    expect(markup).toMatch(/class="[^"]*text-ok[^"]*">Ally<\/span>/);
  });

  it("marks a merged ally with the house mark", () => {
    expect(markup).toContain("Thornwood (31) ⌂");
  });

  it("dates an earlier-turn faction ahead of its attitude", () => {
    expect(markup).toMatch(/last seen turn 41<\/span><span[^>]*>Neutral<\/span>/);
  });

  it("titles a faction row with its full text", () => {
    expect(markup).toContain('title="Greenhollow (58) · last seen turn 41 · Neutral"');
  });

  it("leaves every other row as it was", () => {
    expect(markup).not.toContain('title="plain (12,34)');
  });
});
