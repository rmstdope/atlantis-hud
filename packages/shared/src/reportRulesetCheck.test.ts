import type { ParsedReport } from "@atlantis/core-client";
import { aParsedReport, aReportHeaderInfo, aReportRegion, aReportUnit } from "@atlantis/core-client";
import { readNewAgeArcanumRuleset, readRuleset, readTridentRuleset } from "@atlantis/fixtures";
import { describe, expect, it } from "vitest";
import { parseGameData, type GameDataIndex } from "./gameData";
import {
  checkOpenedReports,
  confirmedWords,
  discordFor,
  issueBody,
  issueTitle,
  issueUrl,
  nowDefined,
  openedReportKey,
  reportCheckWords,
  reportStepIntro,
  stillMissingWords,
  type OpenedReport,
  type ReportCheck
} from "./reportRulesetCheck";

function index(text: string): GameDataIndex {
  const parsed = parseGameData(text);
  if (parsed === null) {
    throw new Error("not a ruleset");
  }
  return parsed;
}

const INDEXES = new Map<string, GameDataIndex>([
  ["neworigins", index(readRuleset())],
  ["newage-arcanum", index(readNewAgeArcanumRuleset())],
  ["newage-trident", index(readTridentRuleset())]
]);

/** A report naming tarot cards [TARO] and annihilation [ANNI]: New Origins defines both, Trident neither (rulesetGaps.test.ts). */
function newOriginsOnly(turnNumber: number, factionId = "95"): ParsedReport {
  return aParsedReport({
    header: aReportHeaderInfo({ factionId, turnNumber }),
    regions: [
      aReportRegion({
        terrain: "plain",
        units: [
          aReportUnit({
            items: [{ amount: 3, name: "tarot cards", tag: "TARO" }],
            skills: [{ name: "annihilation", tag: "ANNI", level: 1, points: 30 }]
          })
        ]
      })
    ]
  });
}

/** Names every shipped ruleset defines. */
function plain(turnNumber: number): ParsedReport {
  return aParsedReport({
    header: aReportHeaderInfo({ turnNumber }),
    regions: [aReportRegion({ terrain: "plain", units: [aReportUnit({ items: [{ amount: 1, name: "silver", tag: "SILV" }] })] })]
  });
}

const opened = (fileName: string, report: ParsedReport): OpenedReport => ({ fileName, report });

function checked(reports: OpenedReport[], rulesetId: string): ReportCheck {
  const check = checkOpenedReports(reports, rulesetId, INDEXES);
  if (check === null) {
    throw new Error("no check");
  }
  return check;
}

describe("checkOpenedReports", () => {
  it("checks each report and groups only the affected ones' names", () => {
    const check = checked(
      [opened("turn-4.rep", newOriginsOnly(4)), opened("turn-5.rep", plain(5)), opened("turn-6.rep", newOriginsOnly(6))],
      "newage-trident"
    );

    expect(check.rulesetId).toBe("newage-trident");
    expect(check.total).toBe(3);
    expect(check.affected.map((report) => report.fileName)).toEqual(["turn-4.rep", "turn-6.rep"]);
    expect(check.gaps.groups).toEqual([
      { kind: "item", names: ["tarot cards"] },
      { kind: "skill", names: ["annihilation"] }
    ]);
    expect(check.gaps.count).toBe(2);
  });

  it("finds nothing affected when the ruleset defines every name", () => {
    const check = checked([opened("turn-4.rep", newOriginsOnly(4))], "neworigins");

    expect(check.affected).toEqual([]);
    expect(check.gaps.count).toBe(0);
  });

  it("is no check at all when the ruleset is not to hand", () => {
    expect(checkOpenedReports([opened("a.rep", plain(1))], "somewhere-else", INDEXES)).toBeNull();
  });
});

describe("openedReportKey", () => {
  it("is the report's faction and turn", () => {
    expect(openedReportKey(newOriginsOnly(4, "12"))).toBe("12:4");
  });

  it("stands in for a header that names neither", () => {
    const report = aParsedReport({ header: aReportHeaderInfo({ factionId: null, turnNumber: null }) });
    expect(openedReportKey(report)).toBe("?:?");
  });
});

describe("nowDefined", () => {
  it("counts the earlier names the new ruleset defines, ignoring names new to the list", () => {
    const before = { totalTurns: 1, affectedTurns: [1], count: 3, groups: [
      { kind: "item" as const, names: ["compass", "crown"] },
      { kind: "skill" as const, names: ["call pirates"] }
    ] };
    const after = { totalTurns: 1, affectedTurns: [1], count: 2, groups: [
      { kind: "item" as const, names: ["crown", "fairy"] }
    ] };

    expect(nowDefined(before, after)).toBe(2);
  });
});

describe("the words", () => {
  const single = checked([opened("turn-4.rep", newOriginsOnly(4))], "newage-trident");
  const batch = checked(
    [opened("turn-2.rep", newOriginsOnly(2)), opened("turn-3.rep", newOriginsOnly(3)), opened("turn-5.rep", plain(5))],
    "newage-trident"
  );

  it("words a single report exactly as agreed", () => {
    const words = reportCheckWords(single, "New Age: Trident");

    expect(words.title).toBe("⚠ Check this game’s ruleset");
    expect(words.intro).toEqual([
      { text: "The report " },
      { text: "turn-4.rep", bold: true },
      { text: " names 2 things the " },
      { text: "New Age: Trident", bold: true },
      { text: " ruleset doesn’t define. This usually means the game was set up with the wrong ruleset." }
    ]);
    expect(words.heading).toBe("Not defined in New Age: Trident");
    expect(words.files).toBeNull();
    expect(words.groups).toEqual([
      { heading: "Items (1)", names: "tarot cards" },
      { heading: "Skills (1)", names: "annihilation" }
    ]);
  });

  it("words a batch with the affected reports named", () => {
    const words = reportCheckWords(batch, "New Age: Trident");

    expect(words.intro).toEqual([
      { text: "2 of the 3 reports you imported name 2 things the " },
      { text: "New Age: Trident", bold: true },
      { text: " ruleset doesn’t define. This usually means the game was set up with the wrong ruleset." }
    ]);
    expect(words.files).toBe("turn-2.rep, turn-3.rep");
  });

  it("words a batch with one affected report as a single report", () => {
    const one = checked([opened("turn-2.rep", newOriginsOnly(2)), opened("turn-5.rep", plain(5))], "newage-trident");
    const words = reportCheckWords(one, "New Age: Trident");

    expect(words.intro[1]).toEqual({ text: "turn-2.rep", bold: true });
    expect(words.files).toBeNull();
  });

  it("confirms a change in the report's name, or the imported reports'", () => {
    expect(confirmedWords("New Origins", ["turn-4.rep"])).toEqual([
      { text: "✓ Changed to " },
      { text: "New Origins", bold: true },
      { text: ". Everything in " },
      { text: "turn-4.rep", bold: true },
      { text: " is now defined." }
    ]);
    expect(confirmedWords("New Origins", ["turn-2.rep", "turn-3.rep"])[3]).toEqual({
      text: "the imported reports",
      bold: true
    });
  });

  it("says how many names a change defined", () => {
    expect(stillMissingWords("New Age: Arcanum", 7, 10)).toBe(
      "Changed to New Age: Arcanum — 7 of the 10 names are now defined."
    );
  });

  it("words the reporting step", () => {
    expect(reportStepIntro("New Origins", 10)).toBe(
      "If New Origins really is this game’s ruleset, the app is missing these 10 names. Please tell us so they can be added."
    );
  });

  it("writes the issue as agreed, every affected turn and no empty group", () => {
    expect(issueTitle("New Age: Trident")).toBe("Names missing from the New Age: Trident ruleset");
    expect(issueBody(batch, "New Age: Trident", "0.42.0")).toBe(
      [
        "A report names things the New Age: Trident ruleset does not define. I have checked that New Age: Trident is the right ruleset for this game.",
        "",
        "Ruleset: New Age: Trident",
        "Report turn: 2, 3",
        "App version: 0.42.0",
        "",
        "Items (1): tarot cards",
        "Skills (1): annihilation"
      ].join("\n")
    );
  });

  it("prefills a new GitHub issue", () => {
    const url = new URL(issueUrl("Names missing from the X ruleset", "a & b\nc"));

    expect(`${url.origin}${url.pathname}`).toBe("https://github.com/rmstdope/atlantis-hud/issues/new");
    expect(url.searchParams.get("title")).toBe("Names missing from the X ruleset");
    expect(url.searchParams.get("body")).toBe("a & b\nc");
  });
});

describe("discordFor", () => {
  it("is each world's Discord, both New Age worlds sharing one", () => {
    expect(discordFor("neworigins")).toEqual({ label: "Open the New Origins Discord", url: "https://discord.gg/2MkXpUTAj" });
    expect(discordFor("newage-arcanum")).toEqual({ label: "Open the New Age Discord", url: "https://discord.gg/Nd835Zj54" });
    expect(discordFor("newage-trident")).toEqual({ label: "Open the New Age Discord", url: "https://discord.gg/Nd835Zj54" });
    expect(discordFor("elsewhere")).toBeNull();
  });
});
