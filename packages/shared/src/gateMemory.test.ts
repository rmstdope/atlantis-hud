import { describe, expect, it } from "vitest";
import { aParsedReport, aReportRegion, aReportUnit } from "@atlantis/core-client";
import {
  gateLineOf,
  mergedGateMemory,
  NO_GATE_MEMORY,
  rememberedGateTitle,
  withGateTurn
} from "./gateMemory";

const SENTENCE = "There is a Gate here (Gate 987).";

/** A unit of ours with Gate Lore 1 - enough to be shown a gate (data/skills `gate lore [GATE] 1`). */
const mage = (over: Parameters<typeof aReportUnit>[0] = {}) =>
  aReportUnit({ skills: [{ name: "gate lore", tag: "GATE", level: 1, points: 30 }], ...over });

const aReport = (over: Parameters<typeof aReportRegion>[0] = {}) =>
  aParsedReport({ regions: [aReportRegion(over)] });

const hexId = aReportRegion().regionId;

describe("gateMemory (ah-r5fg)", () => {
  it("remembers a gate the report printed, with its turn", () => {
    const memory = withGateTurn(NO_GATE_MEMORY, aReport({ gate: SENTENCE, units: [mage()] }), 78);

    expect(memory.get(hexId)).toEqual({ sentence: SENTENCE, turn: 78 });
  });

  it("keeps the gate when nobody there could have seen it", () => {
    const seen = withGateTurn(NO_GATE_MEMORY, aReport({ gate: SENTENCE, units: [mage()] }), 78);
    const later = withGateTurn(seen, aReport({ units: [aReportUnit()] }), 82);

    expect(later.get(hexId)).toEqual({ sentence: SENTENCE, turn: 78 });
  });

  it("forgets the gate when our Gate Lore unit stands there and the report has no gate line", () => {
    const seen = withGateTurn(NO_GATE_MEMORY, aReport({ gate: SENTENCE, units: [mage()] }), 78);
    const later = withGateTurn(seen, aReport({ units: [mage()] }), 82);

    expect(later.get(hexId)).toEqual({ sentence: null, turn: 82 });
  });

  it("is not cleared by a stranger's Gate Lore", () => {
    const seen = withGateTurn(NO_GATE_MEMORY, aReport({ gate: SENTENCE, units: [mage()] }), 78);
    const later = withGateTurn(seen, aReport({ units: [mage({ own: false })] }), 82);

    expect(later.get(hexId)).toEqual({ sentence: SENTENCE, turn: 78 });
  });

  it("settles on the newest turn whatever order the turns are folded in", () => {
    const old = withGateTurn(NO_GATE_MEMORY, aReport({ gate: SENTENCE }), 78);
    const cleared = withGateTurn(NO_GATE_MEMORY, aReport({ units: [mage()] }), 82);

    expect(mergedGateMemory(old, cleared).get(hexId)).toEqual({ sentence: null, turn: 82 });
    expect(mergedGateMemory(cleared, old).get(hexId)).toEqual({ sentence: null, turn: 82 });
  });

  it("never mutates the memory it is given", () => {
    const seen = withGateTurn(NO_GATE_MEMORY, aReport({ gate: SENTENCE }), 78);
    withGateTurn(seen, aReport({ units: [mage()] }), 82);

    expect(seen.get(hexId)).toEqual({ sentence: SENTENCE, turn: 78 });
    expect(NO_GATE_MEMORY.size).toBe(0);
  });
});

describe("gateLineOf (ah-r5fg)", () => {
  it("shows the shown region's own sentence as current", () => {
    expect(gateLineOf(aReportRegion({ gate: SENTENCE }), undefined, 82)).toEqual({
      sentence: SENTENCE,
      seenInTurn: null
    });
  });

  it("shows a remembered gate with the turn it was seen", () => {
    expect(gateLineOf(aReportRegion(), { sentence: SENTENCE, turn: 78 }, 82)).toEqual({
      sentence: SENTENCE,
      seenInTurn: 78
    });
  });

  it("shows nothing for a cleared memory, a hex with no region, or no gate at all", () => {
    expect(gateLineOf(aReportRegion(), { sentence: null, turn: 82 }, 82)).toBeNull();
    expect(gateLineOf(null, { sentence: SENTENCE, turn: 78 }, 82)).toBeNull();
    expect(gateLineOf(aReportRegion(), undefined, 82)).toBeNull();
  });

  it("does not show an older turn what a later one taught", () => {
    expect(gateLineOf(aReportRegion(), { sentence: SENTENCE, turn: 78 }, 70)).toBeNull();
    expect(gateLineOf(aReportRegion(), { sentence: SENTENCE, turn: 78 }, null)).toEqual({
      sentence: SENTENCE,
      seenInTurn: 78
    });
  });

  it("names the turn in the hover, word for word as agreed", () => {
    expect(rememberedGateTitle(78)).toBe(
      "Seen in turn 78's report; this turn's report cannot show gates here."
    );
  });
});
