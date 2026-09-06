import type { ReportUnit } from "@atlantis/core-client";
import { aReportUnit, aUnitSilver } from "@atlantis/core-client";
import { describe, expect, it } from "vitest";
import type { PreviewedUnit } from "./unitPreview";
import { columnHasPopup, popupAsText, popupForCell, type PopupFacts } from "./unitCellPopup";

const unit = (overrides: Partial<PreviewedUnit> = {}): PreviewedUnit => ({
  ...(aReportUnit({ unitId: "1487", name: "Braves" }) as ReportUnit),
  ...overrides
});

const facts = (overrides: Partial<PopupFacts> = {}): PopupFacts => ({
  structureLabel: null,
  longOrder: null,
  silver: null,
  silverWarned: false,
  countUpkeep: false,
  derivedSkills: [],
  dissolving: false,
  ...overrides
});

describe("which columns open anything", () => {
  it("the ownership marker, faction, hex, seen and remove columns open nothing", () => {
    for (const column of ["own", "faction", "hex", "seen", "remove"] as const) {
      expect(columnHasPopup(column)).toBe(false);
      expect(popupForCell(column, unit(), facts())).toEqual({ kind: "silent" });
    }
  });

  it("name and id open the whole-unit summary", () => {
    for (const column of ["name", "unitId"] as const) {
      expect(columnHasPopup(column)).toBe(true);
      expect(popupForCell(column, unit(), facts())).toEqual({ kind: "unit" });
    }
  });
});

const columnPopup = (spec: ReturnType<typeof popupForCell>) => {
  if (spec.kind !== "column") {
    throw new Error(`expected a column popup, got ${spec.kind}`);
  }
  return spec.popup;
};

describe("the column popups", () => {
  it("heads every popup with the unit and the column", () => {
    expect(columnPopup(popupForCell("men", unit(), facts())).title).toBe("Braves (1487) — men");
    expect(columnPopup(popupForCell("longOrder", unit(), facts())).title).toBe(
      "Braves (1487) — long order"
    );
  });

  it("the men popup says what the report counted and why a figure is a guess", () => {
    const popup = columnPopup(
      popupForCell("men", unit({ men: 12, menEstimated: true }), facts())
    );
    expect(popup.lines).toEqual([{ label: "men", value: "~12" }]);
    expect(popup.notes).toContain(
      "Estimated: the report has not been matched against the item catalogue, so only the first group of people is counted."
    );
  });

  it("the men popup marks a change as a direction and an amount", () => {
    const popup = columnPopup(
      popupForCell(
        "men",
        unit({ men: 12, previewChanges: [{ field: "men", original: "8" }] }),
        facts()
      )
    );
    expect(popup.lines).toEqual([
      { label: "men", value: "12", change: { direction: "up", amount: 4 } }
    ]);
  });

  it("the men popup falls back to the report's own words when the original is not a number", () => {
    const popup = columnPopup(
      popupForCell(
        "men",
        unit({ men: 12, previewChanges: [{ field: "men", original: "~8" }] }),
        facts()
      )
    );
    expect(popup.lines).toEqual([{ label: "men", value: "12", why: "was: ~8" }]);
  });

  it("a column with nothing to change says so", () => {
    expect(columnPopup(popupForCell("men", unit(), facts())).notes).toContain(
      "Nothing this month changes this."
    );
    expect(columnPopup(popupForCell("items", unit(), facts())).notes).toContain(
      "Nothing this month changes these."
    );
  });

  it("the movement popup says the movement is not disclosed when the report says nothing", () => {
    const popup = columnPopup(popupForCell("movement", unit({ movement: null }), facts()));
    expect(popup.lines).toEqual([]);
    expect(popup.notes).toContain("Movement not disclosed.");
  });

  it("the movement popup names the mode the report showed", () => {
    const popup = columnPopup(
      popupForCell(
        "movement",
        unit({
          movement: { status: "walk", load: 10, fly: 0, ride: 0, walk: 20, capacityMode: "walk" }
        }),
        facts()
      )
    );
    expect(popup.lines).toEqual([{ label: "move", value: "Walking" }]);
  });

  it("the flags popup names every flag in the report's own words", () => {
    const popup = columnPopup(
      popupForCell("flags", unit({ flags: ["behind", "avoiding"] }), facts())
    );
    expect(popup.lines).toEqual([{ label: "flags", value: "behind · avoiding" }]);
  });

  it("the flags popup says so when none are set", () => {
    expect(columnPopup(popupForCell("flags", unit({ flags: [] }), facts())).notes).toContain(
      "No flags set."
    );
  });

  it("the skills popup lists a unit's own skills with their study points", () => {
    const popup = columnPopup(
      popupForCell(
        "skills",
        unit({ own: true, skills: [{ name: "combat", tag: "COMB", level: 2, points: 90 }] }),
        facts()
      )
    );
    expect(popup.lines).toEqual([{ label: "combat COMB", value: "2 (90)" }]);
  });

  it("the skills popup says a report never shows another faction's skills", () => {
    const popup = columnPopup(
      popupForCell("skills", unit({ own: false, skills: [] }), facts())
    );
    expect(popup.lines).toEqual([]);
    expect(popup.notes).toContain("A report never shows another faction's skills.");
  });

  it("the skills popup names the battle a foreign unit's skills were read from", () => {
    const popup = columnPopup(
      popupForCell(
        "skills",
        unit({ own: false, skills: [] }),
        facts({
          derivedSkills: [
            { name: "combat", tag: "COMB", level: 3, turn: 71, coordinate: null, terrain: null }
          ]
        })
      )
    );
    expect(popup.lines).toEqual([{ label: "combat COMB", value: "3" }]);
    expect(popup.notes.slice(0, 2)).toEqual([
      "Read from a battle on turn 71.",
      "A report never shows another faction's skills."
    ]);
  });

  it("the items popup carries today's items tooltip and explains the plus-question mark", () => {
    const popup = columnPopup(
      popupForCell(
        "items",
        unit({
          items: [{ name: "silver", tag: "SILV", amount: 40 }],
          uncounted: ["@TAX"]
        }),
        facts()
      )
    );
    expect(popup.lines).toEqual([{ label: "silver SILV", value: "40" }]);
    expect(popup.notes).toContain("and more that cannot be counted: @TAX");
    expect(popup.warning).toBe(
      "“+ ?” in the cell: this month is only partly counted, so this list may be short."
    );
  });

  it("the items popup says so when the unit holds nothing", () => {
    const popup = columnPopup(popupForCell("items", unit({ items: [] }), facts()));
    expect(popup.notes).toContain("No items.");
    expect(popup.warning).toBeNull();
  });

  it("the structure popup says the unit is in no structure", () => {
    expect(columnPopup(popupForCell("structure", unit(), facts())).notes).toContain(
      "In no structure."
    );
  });

  it("the structure popup names the structure the row drew", () => {
    const popup = columnPopup(
      popupForCell("structure", unit(), facts({ structureLabel: "Shaft [1] (Mine)" }))
    );
    expect(popup.lines).toEqual([{ label: "structure", value: "Shaft [1] (Mine)" }]);
  });

  it("the structure popup reads its change off the report's own field name", () => {
    const popup = columnPopup(
      popupForCell(
        "structure",
        unit({ previewChanges: [{ field: "structureId", original: "" }] }),
        facts({ structureLabel: "Wavecrest [329] · Longship" })
      )
    );
    expect(popup.lines[0]?.why).toBe("was: —");
    expect(popup.notes).not.toContain("Nothing this month changes this.");
  });

  it("an empty column still says what the report had there", () => {
    const moved = columnPopup(
      popupForCell(
        "structure",
        unit({ previewChanges: [{ field: "structureId", original: "Wavecrest [329] · Longship" }] }),
        facts({ structureLabel: null })
      )
    );
    expect(moved.notes).toEqual([
      "In no structure.",
      "Was: Wavecrest [329] · Longship."
    ]);

    const unflagged = columnPopup(
      popupForCell(
        "flags",
        unit({ flags: [], previewChanges: [{ field: "flags", original: "behind" }] }),
        facts()
      )
    );
    expect(unflagged.notes).toEqual(["No flags set.", "Was: behind."]);

    const still = columnPopup(
      popupForCell(
        "movement",
        unit({ movement: null, previewChanges: [{ field: "movement", original: "Walking" }] }),
        facts()
      )
    );
    expect(still.notes).toEqual(["Movement not disclosed.", "Was: Walking."]);
  });

  it("says the report's own figure once, not twice", () => {
    // `itemsTooltip` already opens with the quote, so a second sentence for the same fact would
    // be read out twice - once in the popup and once in the cell's hidden sentence.
    const popup = columnPopup(
      popupForCell(
        "items",
        unit({
          items: [{ name: "silver", tag: "SILV", amount: 40 }],
          previewChanges: [{ field: "items", original: "20 SILV" }]
        }),
        facts()
      )
    );
    expect(popup.notes.filter((note) => /20 SILV/.test(note))).toEqual(["was: 20 SILV"]);
  });

  it("says nothing moved when the report's figure is the one already shown", () => {
    const popup = columnPopup(
      popupForCell(
        "men",
        unit({ men: 12, previewChanges: [{ field: "men", original: "12" }] }),
        facts()
      )
    );
    expect(popup.lines).toEqual([{ label: "men", value: "12" }]);
    expect(popup.notes).toEqual([]);
  });

  it("quotes the report on a foreign unit's recovered skills", () => {
    const popup = columnPopup(
      popupForCell(
        "skills",
        unit({ own: false, skills: [], previewChanges: [{ field: "skills", original: "" }] }),
        facts({
          derivedSkills: [
            { name: "combat", tag: "COMB", level: 3, turn: 71, coordinate: null, terrain: null }
          ]
        })
      )
    );
    expect(popup.lines[0]?.why).toBe("was: —");
  });

  it("the long order popup says another faction's orders are not in your report", () => {
    expect(
      columnPopup(popupForCell("longOrder", unit({ own: false }), facts())).notes
    ).toContain("Another faction's orders are not in your report.");
  });

  it("the long order popup says when one of ours wrote none", () => {
    expect(
      columnPopup(popupForCell("longOrder", unit({ own: true }), facts())).notes
    ).toContain("No long order this month.");
  });

  it("the long order popup quotes the order the unit wrote", () => {
    const popup = columnPopup(
      popupForCell("longOrder", unit({ own: true }), facts({ longOrder: "STUDY COMB" }))
    );
    expect(popup.lines).toEqual([{ label: "long order", value: "STUDY COMB" }]);
  });

  it("the silver popup carries the forecast's rows and its notes", () => {
    const popup = columnPopup(
      popupForCell(
        "silver",
        unit({ own: true }),
        facts({ silver: aUnitSilver({ held: 100, income: 0, lateIncome: 0, expense: 0 }) })
      )
    );
    expect(popup.lines[0]).toEqual({ label: "Held now", value: "100" });
    expect(popup.lines.at(-1)?.label).toBe("At month end");
  });

  it("the silver popup shows no working for a row the game dissolves", () => {
    const popup = columnPopup(
      popupForCell(
        "silver",
        unit({ own: true }),
        facts({ silver: aUnitSilver({ held: 100 }), dissolving: true })
      )
    );
    expect(popup.lines).toEqual([]);
    expect(popup.notes).toContain(
      "The game dissolves this unit before the month ends, so it has no month end."
    );
  });

  it("the silver popup says only our own units have a forecast", () => {
    expect(columnPopup(popupForCell("silver", unit({ own: false }), facts())).notes).toContain(
      "Only your own units have a silver forecast."
    );
  });

  it("a popup with more lines than it can show says how many were left out", () => {
    const items = Array.from({ length: 19 }, (_, index) => ({
      name: `thing${index}`,
      tag: `T${index}`,
      amount: 20 - index
    }));
    const popup = columnPopup(popupForCell("items", unit({ items }), facts()));
    expect(popup.lines).toHaveLength(12);
    expect(popup.notes).toContain("… and 7 more; select the unit to see them all.");
  });
});

describe("popupAsText", () => {
  it("reads as sentences without repeating the column name", () => {
    const text = popupAsText({
      title: "Braves (1487) — items",
      lines: [
        { label: "silver SILV", value: "40", change: { direction: "up", amount: 4 } },
        { label: "grain GRAI", value: "2", change: { direction: "down", amount: 1 }, why: "1 eaten" }
      ],
      notes: ["was: 36 SILV, 3 GRAI."],
      warning: "This month is only partly counted."
    });
    expect(text).toBe(
      "silver SILV 40, up 4. grain GRAI 2, down 1, 1 eaten. was: 36 SILV, 3 GRAI. This month is only partly counted."
    );
  });

  it("says nothing about a change a line does not carry", () => {
    expect(
      popupAsText({ title: "x", lines: [{ label: "men", value: "12" }], notes: [], warning: null })
    ).toBe("men 12.");
  });
});
