import type { ReportUnit } from "@atlantis/core-client";
import { aReportUnit } from "@atlantis/core-client";
import { describe, expect, it } from "vitest";
import { HOVER_DELAY_MS, placeTooltip, summariseUnit } from "./unitTooltip";

const unit = (overrides: Partial<ReportUnit> = {}): ReportUnit =>
  aReportUnit({ unitId: "18642", name: "Seven of Eight", ...overrides });

describe("HOVER_DELAY_MS", () => {
  it("waits long enough that passing the pointer over the table shows nothing", () => {
    expect(HOVER_DELAY_MS).toBe(300);
  });
});

describe("summariseUnit", () => {
  it("titles the summary with the unit's name and its id", () => {
    expect(summariseUnit(unit()).title).toBe("Seven of Eight (18642)");
  });

  it("lists every skill with its tag and level", () => {
    const summary = summariseUnit(
      unit({
        skills: [
          { name: "observation", tag: "OBSE", level: 3, points: 180 },
          { name: "stealth", tag: "STEA", level: 1, points: 30 }
        ]
      })
    );

    expect(summary.skills).toEqual([
      { label: "observation OBSE", value: "3" },
      { label: "stealth STEA", value: "1" }
    ]);
  });

  it("lists every item, the largest holding first", () => {
    const summary = summariseUnit(
      unit({
        items: [
          { amount: 2, name: "swords", tag: "SWOR" },
          { amount: 1200, name: "silver", tag: "SILV" }
        ]
      })
    );

    expect(summary.items.map((item) => item.label)).toEqual(["silver SILV", "swords SWOR"]);
    // The digits, not the grouping: see the locale test below.
    expect(summary.items.map((item) => item.value.replace(/\D/g, ""))).toEqual(["1200", "2"]);
  });

  /**
   * Asserting "1,200" would pin en-US and fail under a Swedish or German locale while passing on
   * CI - a works-here-fails-there trap the unit composition tests already avoid. The property that
   * matters is that the digits survive and a separator was added, whatever that separator is.
   */
  it("groups thousands in whatever way the reader's locale does", () => {
    const [silver] = summariseUnit(
      unit({ items: [{ amount: 1200, name: "silver", tag: "SILV" }] })
    ).items;

    expect(silver.value.replace(/\D/g, "")).toBe("1200");
    expect(silver.value).not.toBe("1200");
  });

  it("does not reorder the unit's own skills or items lists", () => {
    const skills = [{ name: "stealth", tag: "STEA", level: 1, points: 30 }];
    const items = [
      { amount: 2, name: "swords", tag: "SWOR" },
      { amount: 1200, name: "silver", tag: "SILV" }
    ];
    summariseUnit(unit({ skills, items }));

    expect(items.map((item) => item.tag)).toEqual(["SWOR", "SILV"]);
    expect(skills.map((skill) => skill.tag)).toEqual(["STEA"]);
  });

  it("gives back empty lists for a unit carrying and knowing nothing", () => {
    const summary = summariseUnit(unit());
    expect(summary.skills).toEqual([]);
    expect(summary.items).toEqual([]);
  });
});

/**
 * The tooltip is placed against the pointer, in viewport coordinates.
 *
 * A gap of 12 keeps it clear of the cursor itself, which would otherwise sit on top of the first
 * line of text.
 */
describe("placeTooltip", () => {
  const viewport = { width: 1000, height: 800 };
  const size = { width: 200, height: 100 };

  it("sits below and to the right of the pointer when there is room", () => {
    expect(placeTooltip({ x: 100, y: 100 }, size, viewport)).toEqual({ left: 112, top: 112 });
  });

  it("flips to the left of the pointer rather than run off the right edge", () => {
    expect(placeTooltip({ x: 950, y: 100 }, size, viewport)).toEqual({ left: 738, top: 112 });
  });

  it("flips above the pointer rather than run off the bottom edge", () => {
    expect(placeTooltip({ x: 100, y: 750 }, size, viewport)).toEqual({ left: 112, top: 638 });
  });

  it("stays on screen when neither side has room", () => {
    // A tooltip wider than the viewport has nowhere to flip to, so it is pinned to the left edge
    // rather than left hanging off one side.
    const wide = { width: 1200, height: 100 };
    expect(placeTooltip({ x: 500, y: 100 }, wide, viewport)).toEqual({ left: 0, top: 112 });
  });

  it("never places the tooltip above the top of the viewport", () => {
    const tall = { width: 200, height: 900 };
    expect(placeTooltip({ x: 100, y: 750 }, tall, viewport)).toEqual({ left: 112, top: 0 });
  });
});
