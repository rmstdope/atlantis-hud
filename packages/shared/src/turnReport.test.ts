import { describe, expect, it } from "vitest";
import {
  TURN_REPORT_SILENT,
  TURN_REPORT_TABS,
  type TurnReportCounts,
  turnReportChipLabel,
  turnReportCount,
  turnReportFooter,
  turnReportHeading,
  turnReportIsSilent,
  turnReportIsWarning,
  turnReportOpeningTab,
  turnReportTabLabel,
  turnReportTotal
} from "./turnReport";

const counts = (over: Partial<TurnReportCounts> = {}): TurnReportCounts => ({
  problems: 0,
  engine: 0,
  unreadable: 0,
  events: 0,
  ...over
});

describe("the chip's own text", () => {
  it("counts what is wrong, with no plural to get right", () => {
    expect(turnReportChipLabel(counts({ problems: 10, engine: 1 }))).toBe("11 to check");
  });

  it("says the same thing at one", () => {
    expect(turnReportChipLabel(counts({ engine: 1 }))).toBe("1 to check");
  });

  it("names the report itself when nothing is wrong", () => {
    expect(turnReportChipLabel(counts())).toBe("Turn report");
  });
});

describe("what the folded sources amount to", () => {
  it("the total is what is wrong, and events are not", () => {
    expect(turnReportTotal(counts({ problems: 10, engine: 1, unreadable: 6, events: 333 }))).toBe(
      17
    );
  });

  it("a turn with nothing but events is not a warning", () => {
    expect(turnReportIsWarning(counts({ events: 333 }))).toBe(false);
    expect(turnReportChipLabel(counts({ events: 333 }))).toBe("Turn report");
  });

  it("is a warning as soon as one thing is wrong", () => {
    expect(turnReportIsWarning(counts({ unreadable: 1 }))).toBe(true);
  });

  it("gives each tab its own count, events included", () => {
    const four = counts({ problems: 10, engine: 1, unreadable: 6, events: 333 });
    expect(TURN_REPORT_TABS.map((tab) => turnReportCount(four, tab))).toEqual([10, 1, 6, 333]);
  });
});

describe("the tab row's words", () => {
  it("names each source and the number in it", () => {
    const four = counts({ problems: 10, engine: 1, unreadable: 6, events: 333 });
    expect(turnReportTabLabel("problems", four)).toBe("Problems 10");
    expect(turnReportTabLabel("engine", four)).toBe("Engine 1");
    expect(turnReportTabLabel("unreadable", four)).toBe("Not read 6");
    expect(turnReportTabLabel("events", four)).toBe("Events 333");
  });

  it("reads fixable first, then what already happened", () => {
    expect(TURN_REPORT_TABS).toEqual(["problems", "engine", "unreadable", "events"]);
  });
});

describe("the panel's header line", () => {
  const context = (over: Partial<Parameters<typeof turnReportHeading>[1]> = {}) => ({
    counts: counts({ problems: 10, engine: 1, unreadable: 6, events: 333 }),
    hexCount: 4,
    turnLabel: "71" as string | null,
    ...over
  });

  it("says how many problems there are and how far they are spread", () => {
    expect(turnReportHeading("problems", context())).toBe("10 problems in 4 hexes");
  });

  it("is singular at one of each", () => {
    expect(
      turnReportHeading("problems", context({ counts: counts({ problems: 1 }), hexCount: 1 }))
    ).toBe("1 problem in 1 hex");
  });

  it("uses the report's own words for the engine's errors", () => {
    expect(turnReportHeading("engine", context())).toBe("Errors during turn 71");
    expect(turnReportHeading("engine", context({ turnLabel: null }))).toBe(
      "Errors during this turn"
    );
  });

  it("pairs the same phrasing for the events", () => {
    expect(turnReportHeading("events", context())).toBe("Events during turn 71");
    expect(turnReportHeading("events", context({ turnLabel: null }))).toBe(
      "Events during this turn"
    );
  });

  it("keeps the unread lines' own heading", () => {
    expect(turnReportHeading("unreadable", context())).toBe("Lines that could not be read");
  });
});

describe("the sentence under the body", () => {
  it("keeps the problems panel's own footer", () => {
    expect(turnReportFooter("problems")).toBe(
      "These never block an export. They are what the report says will go wrong, not what the server will refuse."
    );
  });

  it("keeps the unread lines' own footer", () => {
    expect(turnReportFooter("unreadable")).toBe("None of this reached the map.");
  });

  it("has none for what the engine reported", () => {
    expect(turnReportFooter("engine")).toBeNull();
    expect(turnReportFooter("events")).toBeNull();
  });
});

describe("which tab a fresh open lands on", () => {
  it("opening lands on the tab you had open last", () => {
    expect(turnReportOpeningTab("events", counts({ problems: 10, events: 333 }))).toBe("events");
  });

  it("and falls to the first tab with something when that one is now empty", () => {
    expect(turnReportOpeningTab("unreadable", counts({ engine: 1, events: 41 }))).toBe("engine");
  });

  it("falls to problems when there is nothing anywhere", () => {
    expect(turnReportOpeningTab("events", counts())).toBe("problems");
  });
});

describe("a turn with nothing to say", () => {
  it("a turn with all four at zero is silent", () => {
    expect(turnReportIsSilent(counts())).toBe(true);
    expect(turnReportIsSilent(counts({ events: 1 }))).toBe(false);
  });

  it("says so in the navigator's words", () => {
    expect(TURN_REPORT_SILENT).toBe("This turn reported nothing, and your orders look sound.");
  });
});
