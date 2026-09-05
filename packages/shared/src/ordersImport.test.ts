import type { OpenedGame, OrderDiagnostic, ParsedReport, ReportHeaderInfo } from "@atlantis/core-client";
import { aParsedReport, aReportHeaderInfo } from "@atlantis/core-client";
import { describe, expect, it } from "vitest";
import { describeOrdersImport, isOrdersFile, ordersFileFaction, routeOrdersImport, unitLabelForDiagnostic } from "./ordersImport";

/** Shaped exactly like the template a real report carries. */
const ORDERS_FILE = [
  '#atlantis 95 "secret"',
  "",
  ";*** mountain (7,53) in Inhead ***",
  "",
  "unit 18642",
  ";Seven of Eight (18642), avoiding, behind, leader [LEAD].",
  "@claim 50",
  "",
  "unit 99001",
  ";A newly formed unit.",
  "@work",
  "",
  "#end"
].join("\n");

/** A report's opening, which shares nothing with an orders file's. */
const REPORT_START = [";Treasury:", ";", ";Item                                      Rank  Max        Total"].join(
  "\n"
);

describe("recognising an orders file", () => {
  it("recognises an orders file by its header and a report as not one", () => {
    expect(isOrdersFile(ORDERS_FILE)).toBe(true);
    expect(isOrdersFile(REPORT_START)).toBe(false);
  });

  it("looks only at the first non-blank line", () => {
    const withLeadingBlanks = ["", "  ", ORDERS_FILE].join("\n");
    expect(isOrdersFile(withLeadingBlanks)).toBe(true);
  });

  it("reads a file saved with a byte-order mark, which trim() already strips", () => {
    // A property that already held rather than a regression guard: U+FEFF is <ZWNBSP>, part of
    // ECMAScript's WhiteSpace production, so trim() removes it and no code here needs to.
    expect(isOrdersFile("\uFEFF" + ORDERS_FILE)).toBe(true);
  });

  it("finds the header past a byte-order mark ahead of leading blank lines", () => {
    const withBomAndBlanks = "\uFEFF" + ["", "  ", ORDERS_FILE].join("\n");
    expect(isOrdersFile(withBomAndBlanks)).toBe(true);
  });

  it("finds the header past a leading turn-date comment - the ordinary shape of a real export", () => {
    // "; August, Year 1" ahead of "#atlantis" is not a rare case - every .ord file this app's own
    // export writes, and every one at least one other client writes, opens exactly this way.
    const withDateComment = ["; August, Year 1", ORDERS_FILE].join("\n");
    expect(isOrdersFile(withDateComment)).toBe(true);
  });

  it("finds the header past more than one leading comment line", () => {
    const withTwoComments = ["; August, Year 1", "; a second comment line", ORDERS_FILE].join("\n");
    expect(isOrdersFile(withTwoComments)).toBe(true);
  });

  it("does not mistake a report's own leading comments for an orders file", () => {
    const reportWithComments = ["; Treasury:", "; nothing here names a faction"].join("\n");
    expect(isOrdersFile(reportWithComments)).toBe(false);
  });
});

describe("the faction id on the header", () => {
  it("reads the faction id without the password", () => {
    expect(ordersFileFaction(ORDERS_FILE)).toBe("95");
    expect(ordersFileFaction('#atlantis 73 pass')).toBe("73");
  });

  it("returns null for a document with no header", () => {
    expect(ordersFileFaction(REPORT_START)).toBeNull();
  });

  it("reads the faction id past a leading byte-order mark", () => {
    expect(ordersFileFaction("\uFEFF" + ORDERS_FILE)).toBe("95");
  });

  it("reads the faction id past a leading turn-date comment too", () => {
    const withDateComment = ["; August, Year 1", ORDERS_FILE].join("\n");
    expect(ordersFileFaction(withDateComment)).toBe("95");
  });
});

describe("describing an import before it happens", () => {
  const CURRENT = [
    '#atlantis 95 "secret"',
    "",
    "unit 18642",
    ";Seven of Eight (18642), avoiding, behind, leader [LEAD].",
    "@study obse",
    "",
    "unit 13401",
    ";Drone (13401), behind.",
    "",
    "unit 20000",
    ";An empty unit, comments only.",
    "",
    "#end"
  ].join("\n");

  it("counts the file's units", () => {
    expect(describeOrdersImport(ORDERS_FILE, CURRENT).fileUnitIds).toEqual(["18642", "99001"]);
  });

  it("names the units about to be emptied - present with real orders now, absent from the file", () => {
    // 18642 is in the file, so it survives. 13401 has no real orders (comment only), so emptying it
    // costs nothing. 20000 is the same. Nothing here should be emptied by this particular file.
    expect(describeOrdersImport(ORDERS_FILE, CURRENT).emptiedUnitIds).toEqual([]);
  });

  it("does not count a unit with only comments or blank orders as emptied", () => {
    const withOrders = [
      '#atlantis 95 "secret"',
      "",
      "unit 13401",
      ";Drone (13401), behind.",
      "@work",
      "",
      "#end"
    ].join("\n");

    // 13401 now has a real order and is absent from the file - that one should be counted.
    expect(describeOrdersImport(ORDERS_FILE, withOrders).emptiedUnitIds).toEqual(["13401"]);
  });
});

function report(overrides: Partial<ReportHeaderInfo> = {}): ParsedReport {
  return aParsedReport({ header: aReportHeaderInfo({ month: "January", ...overrides }) });
}

const OPEN_GAME = {
  gameFilePath: "p.json",
  databasePath: "p.sqlite",
  schemaVersion: 5,
  manifest: {
    manifestVersion: 1,
    metadata: { gameId: "aug-2026", gameName: "Borg TNG", rulesetId: "neworigins" },
    reportSources: [],
    createdAt: "2026-08-01T09:00:00Z",
    lastOpenedAt: "2026-08-09T18:00:00Z"
  }
} as OpenedGame;

describe("routing a dropped orders file", () => {
  it("refuses when there is no turn to apply orders to", () => {
    expect(routeOrdersImport({ game: null, parsed: null }, ORDERS_FILE, "orders.txt", "")).toEqual({
      kind: "refuse",
      message: "no turn to apply orders to"
    });
    expect(
      routeOrdersImport(
        { game: OPEN_GAME, parsed: report({ turnNumber: null }) },
        ORDERS_FILE,
        "orders.txt",
        ""
      )
    ).toEqual({ kind: "refuse", message: "no turn to apply orders to" });
  });

  it("refuses a file for a different faction, naming both", () => {
    const route = routeOrdersImport(
      { game: OPEN_GAME, parsed: report({ factionId: "17", factionName: "Borg TNG" }) },
      ORDERS_FILE,
      "orders.txt",
      ""
    );

    expect(route).toEqual({
      kind: "refuse",
      message: "orders.txt is orders for faction 95, not Borg TNG (17)"
    });
  });

  it("falls back to unknown and your faction when either side names none", () => {
    const noHeader = '#atlantis\n\nunit 1\n@work\n\n#end';
    const route = routeOrdersImport(
      { game: OPEN_GAME, parsed: report({ factionId: "17", factionName: null }) },
      noHeader,
      "orders.txt",
      ""
    );

    expect(route).toEqual({
      kind: "refuse",
      message: "orders.txt is orders for faction unknown, not 17"
    });
  });

  it("holds the file to ask, with the snapshot taken now", () => {
    const route = routeOrdersImport(
      { game: OPEN_GAME, parsed: report() },
      ORDERS_FILE,
      "orders.txt",
      ""
    );

    expect(route).toEqual({
      kind: "ask",
      pending: {
        text: ORDERS_FILE,
        fileName: "orders.txt",
        factionLabel: "Borg TNG (95)",
        gameId: "aug-2026",
        factionId: "95",
        turnNumber: 71,
        unitCount: 2,
        emptiedCount: 0
      }
    });
  });
});

describe("naming a diagnostic's subject", () => {
  function diagnostic(overrides: Partial<OrderDiagnostic>): OrderDiagnostic {
    return {
      code: "test",
      message: "something is wrong",
      lineStart: null,
      lineEnd: null,
      columnStart: null,
      columnEnd: null,
      regionId: null,
      unitId: null,
      formed: null,
      severity: "error",
      ...overrides
    };
  }

  it("names a formed unit the way the player wrote it", () => {
    expect(
      unitLabelForDiagnostic("", diagnostic({ unitId: "new-1", formed: { alias: "1", formedBy: "1010" } }))
    ).toBe("new 1");
  });

  it("names an ordinary unit by its number", () => {
    expect(unitLabelForDiagnostic("", diagnostic({ unitId: "1815" }))).toBe("1815");
  });

  it("still places a syntax diagnostic by the block its line falls in", () => {
    expect(
      unitLabelForDiagnostic("unit 1815\n@work\n", diagnostic({ lineStart: 2, lineEnd: 2 }))
    ).toBe("1815");
  });
});
