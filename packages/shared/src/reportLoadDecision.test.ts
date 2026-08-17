import { describe, expect, it } from "vitest";
import { aParsedReport, aReportHeaderInfo, aReportRegion } from "@atlantis/core-client";
import type { ParsedReport, ReportHeaderInfo, ReportRegion } from "@atlantis/core-client";
import {
  REPORT_HAS_NOTHING_IN_IT,
  REPORT_NAMES_NO_FACTION,
  REPORT_NAMES_NO_TURN,
  decideReportLoad,
  isOlderTurn,
  judgeReportUsable
} from "./reportLoadDecision";

const borgTng = { factionId: "95", turnNumber: 71 };
const borg = (turnNumber: number | null) => ({ factionId: "73", turnNumber });

function aReport(
  header: Partial<ReportHeaderInfo> = {},
  regions: ReportRegion[] = [aReportRegion()]
): ParsedReport {
  return aParsedReport({
    header: aReportHeaderInfo({ factionId: "73", turnNumber: 71, ...header }),
    regions
  });
}

describe("judging whether a report can be imported at all", () => {
  it("refuses a report that names no faction", () => {
    expect(judgeReportUsable(aReport({ factionId: null }))).toEqual({
      ok: false,
      reason: REPORT_NAMES_NO_FACTION
    });
  });

  it("refuses a report that names no turn", () => {
    expect(judgeReportUsable(aReport({ turnNumber: null }))).toEqual({
      ok: false,
      reason: REPORT_NAMES_NO_TURN
    });
  });

  it("refuses a report with nothing in it", () => {
    expect(judgeReportUsable(aReport({}, []))).toEqual({
      ok: false,
      reason: REPORT_HAS_NOTHING_IN_IT
    });
  });

  it("names the faction before the turn before the contents", () => {
    expect(judgeReportUsable(aReport({ factionId: null, turnNumber: null }, []))).toEqual({
      ok: false,
      reason: REPORT_NAMES_NO_FACTION
    });
    expect(judgeReportUsable(aReport({ turnNumber: null }, []))).toEqual({
      ok: false,
      reason: REPORT_NAMES_NO_TURN
    });
  });

  it("accepts a report with a faction, a turn and one region", () => {
    expect(judgeReportUsable(aReport())).toEqual({ ok: true });
  });
});

describe("isOlderTurn", () => {
  it("is older when the incoming turn is behind what is on screen", () => {
    expect(isOlderTurn(71, 2)).toBe(true);
  });

  it("is not older when the incoming turn is the same or ahead", () => {
    expect(isOlderTurn(71, 71)).toBe(false);
    expect(isOlderTurn(71, 72)).toBe(false);
  });

  it("is not older when either turn number is unknown", () => {
    expect(isOlderTurn(null, 2)).toBe(false);
    expect(isOlderTurn(71, null)).toBe(false);
    expect(isOlderTurn(undefined, 2)).toBe(false);
    expect(isOlderTurn(71, undefined)).toBe(false);
  });
});

describe("deciding what to do with a chosen report", () => {
  it("just loads the first report of all, whatever it is", () => {
    expect(decideReportLoad(null, borg(2))).toEqual({ kind: "load" });
  });

  it("just loads a newer turn of the faction on screen", () => {
    expect(decideReportLoad(borgTng, { factionId: "95", turnNumber: 72 })).toEqual({
      kind: "load"
    });
  });

  it("just loads the turn on screen again", () => {
    expect(decideReportLoad(borgTng, { factionId: "95", turnNumber: 71 })).toEqual({
      kind: "load"
    });
  });

  it("an unreadable turn still loads, since it cannot be told older than anything", () => {
    expect(decideReportLoad(borgTng, { factionId: "95", turnNumber: null })).toEqual({
      kind: "load"
    });
    expect(decideReportLoad({ factionId: "95", turnNumber: null }, borgTng)).toEqual({
      kind: "load"
    });
  });

  it("an older own report is stored for history, not shown", () => {
    expect(decideReportLoad(borgTng, { factionId: "95", turnNumber: 70 })).toEqual({
      kind: "storeOnly",
      currentTurn: 71,
      incomingTurn: 70
    });
  });

  it("an older foreign report is stored for history too - age outranks ownership", () => {
    expect(decideReportLoad(borgTng, borg(2))).toEqual({
      kind: "storeOnly",
      currentTurn: 71,
      incomingTurn: 2
    });
  });

  it("a same-turn foreign report still asks, with merge on offer", () => {
    expect(decideReportLoad(borgTng, borg(71))).toEqual({ kind: "ask", canMerge: true });
  });

  it("asks about another faction's newer report, and will not merge that either", () => {
    expect(decideReportLoad(borgTng, borg(72))).toEqual({ kind: "ask", canMerge: false });
  });

  it("will not merge into a turn it cannot number", () => {
    expect(decideReportLoad({ factionId: "95", turnNumber: null }, borg(71))).toEqual({
      kind: "ask",
      canMerge: false
    });
    expect(decideReportLoad(borgTng, borg(null))).toEqual({
      kind: "ask",
      canMerge: false
    });
  });

  /**
   * A screen whose faction cannot be read is not evidence of another faction: the incoming report
   * just loads.
   */
  it("does not raise the question over a faction it cannot read", () => {
    expect(decideReportLoad({ factionId: null, turnNumber: 71 }, borg(71))).toEqual({
      kind: "load"
    });
  });

});
