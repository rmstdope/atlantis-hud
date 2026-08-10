import { describe, expect, it } from "vitest";
import {
  describeMerge,
  foreignReportPromptCopy,
  type ForeignReportPromptCopy
} from "./foreignReport";

const base: ForeignReportPromptCopy = {
  fileName: "turn-71-f73.rep",
  incomingFactionLabel: "Borg (73)",
  viewerFactionLabel: "Borg TNG (95)",
  incomingTurn: 71,
  viewerTurn: 71,
  canMerge: true
};

const prose = (overrides: Partial<ForeignReportPromptCopy> = {}) =>
  foreignReportPromptCopy({ ...base, ...overrides }).join(" ");

describe("asking what to do with another faction's report", () => {
  it("names the file, both factions and the turn", () => {
    const text = prose();

    expect(text).toContain("turn-71-f73.rep");
    expect(text).toContain("Borg (73)");
    expect(text).toContain("Borg TNG (95)");
    expect(text).toContain("turn 71");
  });

  it("says what merging does, and that it changes nothing about who you are playing", () => {
    expect(prose()).toContain("leaves you playing Borg TNG (95)");
  });

  it("always says what switching costs, because it is the choice that cannot be undone", () => {
    expect(prose()).toContain("the map, the units and the orders all become Borg (73)’s");
    expect(prose({ canMerge: false, incomingTurn: 2 })).toContain(
      "the map, the units and the orders all become Borg (73)’s"
    );
  });

  it("does not offer to merge a report from another turn, and says why", () => {
    const text = prose({ canMerge: false, incomingTurn: 2 });

    expect(text).not.toContain("Merge adds");
    expect(text).toContain("Merging needs a report from turn 71");
  });

  it("warns that an older report may not be the latest one", () => {
    expect(prose({ canMerge: false, incomingTurn: 2 })).toContain(
      "older than the turn you have loaded"
    );
  });

  it("does not call a newer report older", () => {
    expect(prose({ canMerge: false, incomingTurn: 72 })).not.toContain("older than");
  });

  /** A report the parser could not number still has to be describable, not blank. */
  it("says so plainly when a turn cannot be read", () => {
    expect(prose({ canMerge: false, incomingTurn: null })).toContain("an unnumbered turn");
  });
});

describe("reporting a finished merge", () => {
  it("says how much came across and how much of it was new", () => {
    expect(
      describeMerge({
        turnNumber: 71,
        mergedFactionId: "73",
        mergedFactionName: "Borg",
        mergedRegionCount: 31,
        newRegionCount: 12
      })
    ).toBe("merged 31 regions from Borg (73), turn 71 — 12 new to your map");
  });

  it("counts a single region as one region", () => {
    expect(
      describeMerge({
        turnNumber: 71,
        mergedFactionId: "73",
        mergedFactionName: "Borg",
        mergedRegionCount: 1,
        newRegionCount: 0
      })
    ).toBe("merged 1 region from Borg (73), turn 71 — 0 new to your map");
  });
});
