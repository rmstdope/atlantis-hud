import type { ReportUnit, StudyDoubt, StudyForecast } from "@atlantis/core-client";
import { aReportUnit, aUnitSilver } from "@atlantis/core-client";
import { describe, expect, it } from "vitest";
import type { PreviewedUnit } from "./unitPreview";
import {
  columnHasPopup,
  popupAsText,
  popupForCell,
  popupLabelInk,
  reportedItems,
  type PopupFacts
} from "./unitCellPopup";

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
  unitNames: new Map(),
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

  it("the men popup marks a change as the pair it came from", () => {
    const popup = columnPopup(
      popupForCell(
        "men",
        unit({ men: 12, previewChanges: [{ field: "men", original: "8" }] }),
        facts()
      )
    );
    expect(popup.lines).toEqual([
      { label: "men", value: "12", change: { direction: "up", from: "8" } }
    ]);
  });

  it("the men popup formats both halves of the pair the same way", () => {
    const popup = columnPopup(
      popupForCell(
        "men",
        unit({ men: 42255, previewChanges: [{ field: "men", original: "42100" }] }),
        facts()
      )
    );
    // Grouped through `toLocaleString`, which follows the runner's own locale - so the pinned
    // expectation is that both halves are grouped the same way, not that the separator is a comma.
    // Five figures rather than four: many locales set `minimumGroupingDigits: 2` and leave a
    // four-figure number ungrouped (`es-ES` gives `4210`), which would make the expectation equal
    // to the raw string the old code passed through, and the test would pass against it.
    expect(popup.lines).toEqual([
      {
        label: "men",
        value: (42255).toLocaleString(),
        change: { direction: "up", from: (42100).toLocaleString() }
      }
    ]);
  });

  it("the men popup quotes the report when it recorded no original figure", () => {
    const popup = columnPopup(
      popupForCell(
        "men",
        unit({ men: 12, previewChanges: [{ field: "men", original: "" }] }),
        facts()
      )
    );
    expect(popup.lines).toEqual([{ label: "men", value: "12", why: "was: —" }]);
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

  it("the men popup draws a line for each race, paired against the report", () => {
    const popup = columnPopup(
      popupForCell(
        "men",
        unit({
          men: 15,
          menByRace: [
            { amount: 13, name: "humans", tag: "HUMN" },
            { amount: 2, name: "orcs", tag: "ORC" }
          ],
          previewChanges: [
            { field: "men", original: "14" },
            { field: "items", original: "10 HUMN, 4 ORC, 380 SILV" }
          ]
        }),
        facts()
      )
    );
    expect(popup.lines).toEqual([
      { label: "men", value: "15", change: { direction: "up", from: "14" } },
      { label: "humans HUMN", value: "13", change: { direction: "up", from: "10" } },
      { label: "orcs ORC", value: "2", change: { direction: "down", from: "4" } }
    ]);
  });

  it("a race the report never listed starts at none, and one it no longer holds ends at gone", () => {
    const popup = columnPopup(
      popupForCell(
        "men",
        unit({
          men: 15,
          menByRace: [{ amount: 15, name: "humans", tag: "HUMN" }],
          itemChanges: [
            {
              tag: "ORC",
              name: "orcs",
              delta: -14,
              cause: "given-away",
              line: null,
              unitPrice: null,
              other: null,
              isMan: true
            }
          ],
          previewChanges: [{ field: "items", original: "14 ORC" }]
        }),
        facts()
      )
    );
    expect(popup.lines).toEqual([
      { label: "men", value: "15" },
      { label: "humans HUMN", value: "15", change: { direction: "up", from: "none" } },
      // Its label comes from the `ItemChange`'s own name: `menByRace` no longer carries it.
      { label: "orcs ORC", value: "gone", change: { direction: "down", from: "14" } }
    ]);
  });

  it("the men popup draws no race pairs when the report's item list cannot be parsed", () => {
    const popup = columnPopup(
      popupForCell(
        "men",
        unit({
          men: 15,
          menByRace: [{ amount: 15, name: "humans", tag: "HUMN" }],
          previewChanges: [{ field: "items", original: "was: 10 HUMN" }]
        }),
        facts()
      )
    );
    expect(popup.lines).toEqual([
      { label: "men", value: "15" },
      { label: "humans HUMN", value: "15" }
    ]);
  });

  it("the men popup draws no race lines for an estimated headcount", () => {
    const popup = columnPopup(
      popupForCell(
        "men",
        unit({
          men: 50,
          menEstimated: true,
          menByRace: [{ amount: 50, name: "humans", tag: "HUMN" }],
          previewChanges: [{ field: "items", original: "50 HUMN" }]
        }),
        facts()
      )
    );
    expect(popup.lines).toEqual([{ label: "men", value: "~50" }]);
  });

  const manChange = (
    overrides: Partial<NonNullable<PreviewedUnit["itemChanges"]>[number]>
  ) =>
    ({
      tag: "HUMN",
      name: "humans",
      delta: 1,
      cause: "bought",
      line: null,
      unitPrice: null,
      other: null,
      isMan: true,
      ...overrides
    }) as NonNullable<PreviewedUnit["itemChanges"]>[number];

  it("the men popup names every movement of one race in a single sentence", () => {
    const popup = columnPopup(
      popupForCell(
        "men",
        unit({
          men: 15,
          menByRace: [
            { amount: 13, name: "humans", tag: "HUMN" },
            { amount: 2, name: "orcs", tag: "ORC" }
          ],
          previewChanges: [
            { field: "men", original: "14" },
            { field: "items", original: "10 HUMN, 4 ORC, 380 SILV" }
          ],
          itemChanges: [
            manChange({ cause: "bought", delta: 6, unitPrice: 60 }),
            manChange({
              cause: "given-away",
              delta: -3,
              other: { unitId: "1604", name: "Watch" }
            }),
            manChange({
              tag: "ORC",
              name: "orcs",
              cause: "was-taken-from",
              delta: -2,
              other: { unitId: "1502", name: "Scouts" }
            })
          ]
        }),
        facts()
      )
    );
    expect(popup.notes).toEqual([
      "humans: recruited 6 at 60 silver each, gave 3 to Watch (1604).",
      "orcs: 2 taken by Scouts (1502)."
    ]);
  });

  it("the men popup names men taken from a unit the report does not show", () => {
    const popup = columnPopup(
      popupForCell(
        "men",
        unit({ men: 15, menOfUnknownSkill: [{ amount: 4, tag: "HUMN", from: "1502" }] }),
        facts()
      )
    );
    expect(popup.notes).toContain("4 men taken from unit 1502, which your report does not show.");
  });

  it("the men popup does not claim nothing changed when only the races moved", () => {
    // Three orcs given away and three humans recruited: the headcount is unmoved, so the core
    // records no `men` change at all while two races moved.
    const popup = columnPopup(
      popupForCell(
        "men",
        unit({
          men: 3,
          menByRace: [{ amount: 3, name: "humans", tag: "HUMN" }],
          previewChanges: [{ field: "items", original: "3 ORC" }],
          itemChanges: [manChange({ cause: "bought", delta: 3, unitPrice: 60 })]
        }),
        facts()
      )
    );
    expect(popup.notes).not.toContain("Nothing this month changes this.");
  });

  it("a unit whose men nothing touched still says so", () => {
    expect(columnPopup(popupForCell("men", unit({ men: 3 }), facts())).notes).toContain(
      "Nothing this month changes this."
    );
  });

  it("the men popup warns that an estimated headcount cannot be worked out", () => {
    const popup = columnPopup(
      popupForCell(
        "men",
        unit({
          men: 50,
          menEstimated: true,
          itemChanges: [manChange({ cause: "bought", delta: 6, unitPrice: 60 })]
        }),
        facts()
      )
    );
    expect(popup.warning).toBe(
      "This unit's headcount is a guess, so what this month does to it cannot be worked out."
    );
    expect(popup.notes).toContain("humans: recruited 6 at 60 silver each.");
    expect(popup.notes).toContain(
      "Estimated: the report has not been matched against the item catalogue, so only the first group of people is counted."
    );
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
    expect(popup.lines).toEqual([
      { label: "move", value: "Walking" },
      { label: "weight", value: "10" },
      { label: "can carry flying", value: "0", stress: "aside" },
      { label: "can carry riding", value: "0", stress: "aside" },
      { label: "can carry walking", value: "20", stress: "deciding" }
    ]);
  });

  const movementPopup = (overrides: Partial<PreviewedUnit>) =>
    columnPopup(popupForCell("movement", unit(overrides), facts()));

  const carried = (
    overrides: Partial<NonNullable<PreviewedUnit["itemChanges"]>[number]> = {}
  ) =>
    ({
      tag: "GRAI",
      name: "grain",
      delta: 6,
      cause: "was-given",
      line: null,
      unitPrice: null,
      other: { unitId: "1502", name: "Farmers" },
      isMan: false,
      ...overrides
    }) as NonNullable<PreviewedUnit["itemChanges"]>[number];

  it("the movement popup draws the load and each carrying capacity", () => {
    const popup = movementPopup({
      movement: { status: "ride", load: 60, fly: 0, ride: 70, walk: 85, capacityMode: "ride" }
    });
    expect(popup.lines).toEqual([
      { label: "move", value: "Riding" },
      { label: "weight", value: "60" },
      { label: "can carry flying", value: "0", stress: "aside" },
      { label: "can carry riding", value: "70", stress: "deciding" },
      { label: "can carry walking", value: "85", stress: "aside" }
    ]);
  });

  it("marks the largest capacity as the deciding one for an overloaded unit", () => {
    const popup = movementPopup({
      movement: { status: "overloaded", load: 90, fly: 0, ride: 70, walk: 85, capacityMode: "walk" }
    });
    const stress = Object.fromEntries(popup.lines.map((line) => [line.label, line.stress]));
    expect(stress["can carry walking"]).toBe("deciding");
    expect(stress["can carry riding"]).toBe("aside");
    expect(stress["can carry flying"]).toBe("aside");
  });

  it("draws the mode as a pair when it rose", () => {
    const popup = movementPopup({
      movement: { status: "ride", load: 60, fly: 0, ride: 70, walk: 85, capacityMode: "ride" },
      previewChanges: [{ field: "movement", original: "Walking" }]
    });
    expect(popup.lines[0]).toEqual({
      label: "move",
      value: "Riding",
      change: { direction: "up", from: "Walking" }
    });
  });

  it("draws a lost mode as a fall", () => {
    const popup = movementPopup({
      movement: { status: "overloaded", load: 90, fly: 0, ride: 70, walk: 85, capacityMode: "walk" },
      previewChanges: [{ field: "movement", original: "Riding" }]
    });
    expect(popup.lines[0]).toEqual({
      label: "move",
      value: "Overloaded",
      change: { direction: "down", from: "Riding" }
    });
  });

  it("quotes a mode word it does not know rather than ranking it", () => {
    const popup = movementPopup({
      movement: { status: "walk", load: 10, fly: 0, ride: 0, walk: 20, capacityMode: "walk" },
      previewChanges: [{ field: "movement", original: "Swimming" }]
    });
    expect(popup.lines[0]).toEqual({ label: "move", value: "Walking", why: "was: Swimming" });
  });

  it("names every item the month moved, in the month's order", () => {
    const popup = movementPopup({
      movement: { status: "overloaded", load: 90, fly: 0, ride: 70, walk: 85, capacityMode: "walk" },
      items: [
        { name: "grain", tag: "GRAI", amount: 6 },
        { name: "horse", tag: "HORS", amount: 1 }
      ],
      itemChanges: [
        carried({}),
        carried({ tag: "HORS", name: "horse", delta: 1, cause: "bought", unitPrice: 65, other: null })
      ]
    });
    expect(popup.notes.slice(-2)).toEqual([
      "Grain: given 6 by Farmers (1502).",
      "Horse: bought 1 at 65 silver each."
    ]);
  });

  it("counts the items it does not have room to name", () => {
    const tags = Array.from({ length: 14 }, (_, index) => `T${index}`);
    const popup = movementPopup({
      movement: { status: "walk", load: 10, fly: 0, ride: 0, walk: 20, capacityMode: "walk" },
      items: tags.map((tag) => ({ name: tag.toLowerCase(), tag, amount: 1 })),
      itemChanges: tags.map((tag) => carried({ tag, name: tag.toLowerCase(), other: null }))
    });
    // One N2 sentence, twelve named tags, and the counting line.
    expect(popup.notes).toHaveLength(14);
    expect(popup.notes[13]).toBe("… and 2 more; the Items column has them all.");
  });

  it("says the load moved when the mode did not", () => {
    const popup = movementPopup({
      movement: { status: "walk", load: 10, fly: 0, ride: 0, walk: 20, capacityMode: "walk" },
      items: [{ name: "grain", tag: "GRAI", amount: 6 }],
      itemChanges: [carried({})]
    });
    expect(popup.notes[0]).toBe("Its load changed this month, but not the mode it travels in.");
    expect(popup.notes).not.toContain("Nothing this month changes this.");
  });

  it("names the causes and no N2 sentence when the mode moved too", () => {
    const popup = movementPopup({
      movement: { status: "overloaded", load: 90, fly: 0, ride: 70, walk: 85, capacityMode: "walk" },
      items: [{ name: "grain", tag: "GRAI", amount: 6 }],
      itemChanges: [carried({})],
      previewChanges: [{ field: "movement", original: "Riding" }]
    });
    expect(popup.notes).toEqual(["Grain: given 6 by Farmers (1502)."]);
  });

  it("keeps the shared sentence for a month that moved nothing", () => {
    const popup = movementPopup({
      movement: { status: "walk", load: 10, fly: 0, ride: 0, walk: 20, capacityMode: "walk" }
    });
    expect(popup.notes).toContain("Nothing this month changes this.");
    expect(popup.notes).not.toContain("Its load changed this month, but not the mode it travels in.");
  });

  it("warns when an order this month could not be counted", () => {
    const popup = movementPopup({
      movement: { status: "walk", load: 10, fly: 0, ride: 0, walk: 20, capacityMode: "walk" },
      uncounted: ["BUY 1 ZZZZ"]
    });
    expect(popup.warning).toBe(
      "An order this month could not be counted, so these are the report\u2019s own figures, not this month\u2019s."
    );
  });

  it("warns when a cast's yield is still a range", () => {
    const popup = movementPopup({
      movement: { status: "walk", load: 10, fly: 0, ride: 0, walk: 20, capacityMode: "walk" },
      created: [{ fewest: 1, most: 3, tag: "MITH", summoned: false }]
    });
    expect(popup.warning).toBe(
      "An order this month could not be counted, so these are the report\u2019s own figures, not this month\u2019s."
    );
  });

  it("the hidden sentence names the capacity that decides", () => {
    const popup = movementPopup({
      movement: { status: "ride", load: 60, fly: 0, ride: 70, walk: 85, capacityMode: "ride" }
    });
    expect(popupAsText(popup)).toContain("can carry riding 70, which is the one that decides.");
  });

  it("says how a line's label is drawn", () => {
    expect(popupLabelInk({ label: "can carry riding", value: "70", stress: "deciding" })).toBe(
      "text-brass"
    );
    expect(popupLabelInk({ label: "can carry flying", value: "0", stress: "aside" })).toBe(
      "text-ink-dim"
    );
    expect(popupLabelInk({ label: "move", value: "Riding" })).toBe("");
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
    // The pair carries the report's figure now, so no note may restate it - it would be read out
    // twice, once in the popup and once in the cell's hidden sentence.
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
    expect(popup.lines).toEqual([
      { label: "silver SILV", value: "40", change: { direction: "up", from: "20" } }
    ]);
    expect(popup.notes.filter((note) => /20 SILV/.test(note))).toEqual([]);
  });

  it("draws what a unit that gave everything away used to hold", () => {
    const popup = columnPopup(
      popupForCell(
        "items",
        unit({ items: [], previewChanges: [{ field: "items", original: "20 SILV" }] }),
        facts()
      )
    );
    expect(popup.lines).toEqual([
      { label: "SILV", value: "gone", change: { direction: "down", from: "20" } }
    ]);
    // It has lines, so the shared "Was: ..." sentence never fires and the list is not empty.
    expect(popup.notes).not.toContain("No items.");
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

  // `ah-rgkk.4.3`, decision **V2**: the pair, then one line per cause, in the turn's own order.
  // The scene is the chosen mockup's - Collectors, holding 340, ending on 320.
  it("the silver popup draws the month's total as a pair and one line per cause", () => {
    const popup = columnPopup(
      popupForCell(
        "silver",
        unit({ own: true }),
        facts({
          silver: aUnitSilver({
            held: 340,
            atMonthEnd: 320,
            changes: [
              { amount: 200, cause: "taxed", line: 2, other: null },
              { amount: 50, cause: "was-given", line: null, other: "Watch (1604)" },
              { amount: -60, cause: "studied", line: 3, other: null },
              { amount: -90, cause: "bought", line: 4, other: null },
              { amount: -40, cause: "gave-away", line: 5, other: "Scouts (1502)" }
            ]
          })
        })
      )
    );
    expect(popup.lines).toEqual([
      { label: "silver", value: "320", change: { direction: "down", from: "340" } },
      { label: "taxed", value: "+200", tone: "up" },
      { label: "was given", value: "+50", tone: "up", why: "from Watch (1604)" },
      { label: "studied", value: "-60", tone: "down" },
      { label: "bought", value: "-90", tone: "down" },
      { label: "gave away", value: "-40", tone: "down", why: "to Scouts (1502)" }
    ]);
  });

  it("the silver popup shows no pair for a figure that did not move or could not be priced", () => {
    const still = columnPopup(
      popupForCell(
        "silver",
        unit({ own: true }),
        facts({ silver: aUnitSilver({ held: 100, atMonthEnd: 100 }) })
      )
    );
    expect(still.lines[0]).toEqual({ label: "silver", value: "100" });

    const doubted = columnPopup(
      popupForCell(
        "silver",
        unit({ own: true }),
        facts({ silver: aUnitSilver({ held: 100, atMonthEnd: null, doubt: "unknown-tax-base" }) })
      )
    );
    expect(doubted.lines[0]).toEqual({ label: "silver", value: "?" });
  });

  it("the silver popup merges every movement with one cause into one line", () => {
    const popup = columnPopup(
      popupForCell(
        "silver",
        unit({ own: true }),
        facts({
          silver: aUnitSilver({
            held: 0,
            atMonthEnd: 80,
            changes: [
              { amount: 50, cause: "was-given", line: null, other: "Watch (1604)" },
              { amount: 30, cause: "was-given", line: null, other: "unit 1901" }
            ]
          })
        })
      )
    );
    expect(popup.lines[1]).toEqual({
      label: "was given",
      value: "+80",
      tone: "up",
      why: "from Watch (1604) and unit 1901"
    });
    expect(popup.lines).toHaveLength(2);
  });

  // `SilverChangeCause` is generated, so the core may ship a cause this package has not been
  // taught: it still gets a line, a figure and a readable label.
  it("the silver popup gives a cause it has not been taught a line of its own", () => {
    const popup = columnPopup(
      popupForCell(
        "silver",
        unit({ own: true }),
        facts({
          silver: aUnitSilver({
            held: 0,
            atMonthEnd: 25,
            changes: [
              { amount: 25, cause: "found-treasure" as never, line: null, other: null }
            ]
          })
        })
      )
    );
    expect(popup.lines[1]).toEqual({ label: "found treasure", value: "+25", tone: "up" });
  });

  it("the silver popup names who gave and who was taken from", () => {
    const popup = columnPopup(
      popupForCell(
        "silver",
        unit({ own: true }),
        facts({
          silver: aUnitSilver({
            held: 0,
            atMonthEnd: 30,
            changes: [{ amount: 30, cause: "took", line: 2, other: "Watch (1604)" }]
          })
        })
      )
    );
    expect(popup.lines[1]?.why).toBe("from Watch (1604)");
  });

  it("the silver popup says which sources of a take the report does not show", () => {
    const popup = columnPopup(
      popupForCell(
        "silver",
        unit({ own: true }),
        facts({
          silver: aUnitSilver({
            held: 0,
            atMonthEnd: 70,
            changes: [
              { amount: 30, cause: "took", line: 2, other: "Watch (1604)" },
              { amount: 40, cause: "took-unshown", line: 2, other: "unit 1901" }
            ]
          })
        })
      )
    );
    expect(popup.lines[1]).toEqual({
      label: "took",
      value: "+70",
      tone: "up",
      why: "from Watch (1604), from unit 1901, which your report does not show"
    });
  });

  it("the silver popup prices a purchase from the item ledger", () => {
    const popup = columnPopup(
      popupForCell(
        "silver",
        unit({
          own: true,
          itemChanges: [
            {
              tag: "HORS",
              name: "horse",
              delta: 2,
              cause: "bought",
              line: 7,
              unitPrice: 45,
              other: null,
              isMan: false
            }
          ]
        }),
        facts({
          silver: aUnitSilver({
            held: 100,
            atMonthEnd: 10,
            changes: [{ amount: -90, cause: "bought", line: 7, other: null }]
          })
        })
      )
    );
    expect(popup.lines[1]?.why).toBe("2 horses at 45 each");
  });

  it("the silver popup says when a unit taxes or works without an order", () => {
    const popup = columnPopup(
      popupForCell(
        "silver",
        unit({ own: true }),
        facts({
          silver: aUnitSilver({
            held: 0,
            atMonthEnd: 250,
            taxesByFlag: true,
            worksByDefault: true,
            changes: [
              { amount: 200, cause: "taxed", line: null, other: null },
              { amount: 50, cause: "worked", line: null, other: null }
            ]
          })
        })
      )
    );
    expect(popup.lines[1]?.why).toBe("set to tax every turn");
    expect(popup.lines[2]?.why).toBe("no month-long order, arrives too late");
  });

  // `rules/sequenceofevents`: ENTERTAIN and WORK are processed after STUDY, BUY and BUILD, so a
  // wage cannot pay for any of them.
  it("the silver popup says that wages arrive too late", () => {
    const popup = columnPopup(
      popupForCell(
        "silver",
        unit({ own: true }),
        facts({
          silver: aUnitSilver({
            held: 0,
            atMonthEnd: 20,
            changes: [{ amount: 20, cause: "entertained", line: 2, other: null }]
          })
        })
      )
    );
    expect(popup.lines[1]?.why).toBe("arrives too late");
  });

  it("the silver popup draws upkeep only while the column counts it", () => {
    const silver = aUnitSilver({
      held: 340,
      atMonthEnd: 400,
      upkeep: 80,
      changes: [{ amount: 60, cause: "taxed", line: 2, other: null }]
    });
    const counted = columnPopup(
      popupForCell("silver", unit({ own: true }), facts({ silver, countUpkeep: true }))
    );
    expect(counted.lines[0]).toEqual({
      label: "silver",
      value: "320",
      change: { direction: "down", from: "340" }
    });
    expect(counted.lines.at(-1)).toEqual({ label: "upkeep", value: "-80", tone: "down" });

    const uncounted = columnPopup(
      popupForCell("silver", unit({ own: true }), facts({ silver, countUpkeep: false }))
    );
    expect(uncounted.lines[0]).toEqual({
      label: "silver",
      value: "400",
      change: { direction: "up", from: "340" }
    });
    expect(uncounted.lines.map((line) => line.label)).not.toContain("upkeep");
  });

  // Decision **W1**: one amber line at the foot, each sentence naming the mark it explains.
  it("the silver popup explains a red figure that ends below zero", () => {
    const popup = columnPopup(
      popupForCell(
        "silver",
        unit({ own: true }),
        facts({ silver: aUnitSilver({ held: 0, atMonthEnd: -60 }) })
      )
    );
    expect(popup.warning).toBe("A red figure in the cell: this unit ends the month 60 short.");
  });

  it("the silver popup explains a red figure whose orders cannot be paid", () => {
    const popup = columnPopup(
      popupForCell(
        "silver",
        unit({ own: true }),
        facts({ silver: aUnitSilver({ held: 100, atMonthEnd: 40, shortForOrders: 95 }) })
      )
    );
    expect(popup.warning).toBe(
      "A red figure in the cell: this unit cannot pay for its own orders out of silver that reaches it in time."
    );
  });

  it("the silver popup explains the warning mark", () => {
    const popup = columnPopup(
      popupForCell(
        "silver",
        unit({ own: true }),
        facts({ silver: aUnitSilver({ held: 100, atMonthEnd: 100 }), silverWarned: true })
      )
    );
    expect(popup.warning).toBe(
      "⚠ in the cell: a check warns about this unit's money. Select the unit to read it in the Problems panel."
    );
  });

  it("the silver popup explains both marks in one amber line", () => {
    const popup = columnPopup(
      popupForCell(
        "silver",
        unit({ own: true }),
        facts({ silver: aUnitSilver({ held: 0, atMonthEnd: -60 }), silverWarned: true })
      )
    );
    expect(popup.warning).toBe(
      "A red figure in the cell: this unit ends the month 60 short. ⚠ in the cell: a check warns about this unit's money. Select the unit to read it in the Problems panel."
    );
  });

  it("the silver popup leaves an unmarked cell without an amber line", () => {
    const popup = columnPopup(
      popupForCell(
        "silver",
        unit({ own: true }),
        facts({ silver: aUnitSilver({ held: 100, atMonthEnd: 100 }) })
      )
    );
    expect(popup.warning).toBeNull();
  });

  // Decision **N2**: the six notes whose whole content the lines now restate stop being drawn on
  // this surface; every caveat stays.
  it("the silver popup drops the notes its lines already say", () => {
    const popup = columnPopup(
      popupForCell(
        "silver",
        unit({ own: true }),
        facts({
          silverWarned: true,
          countUpkeep: true,
          silver: aUnitSilver({
            held: 0,
            atMonthEnd: 280,
            upkeep: 10,
            unclaimedContended: true,
            received: 50,
            givers: ["Watch (1604)"],
            taken: 30,
            takenFrom: ["Scouts (1502)"],
            takenUnshown: 40,
            takenUnshownFrom: ["unit 1901"],
            givenToNobody: 10,
            taxesByFlag: true,
            worksByDefault: true,
            changes: [
              { amount: 200, cause: "taxed", line: null, other: null },
              { amount: 50, cause: "was-given", line: null, other: "Watch (1604)" }
            ]
          })
        })
      )
    );
    const said = popup.notes.join(" ");
    for (const restated of ["was given", "took", "taxes every turn", "no month-long order"]) {
      expect(said.toLowerCase()).not.toContain(restated.toLowerCase());
    }
    expect(popup.notes).toContain(
      "There is not enough unclaimed silver to feed every unit that needs it."
    );
  });

  // A doubted month draws no cause lines at all, so there is nothing to have restated the notes:
  // dropping them then would take the sentence away and put nothing in its place.
  it("the silver popup keeps every note for a month it cannot add up", () => {
    const popup = columnPopup(
      popupForCell(
        "silver",
        unit({ own: true }),
        facts({
          silver: aUnitSilver({
            held: 100,
            atMonthEnd: null,
            doubt: "unknown-tax-base",
            received: 50,
            givers: ["Watch (1604)"],
            givenToNobody: 10,
            taxesByFlag: true,
            changes: []
          })
        })
      )
    );
    const said = popup.notes.join(" ");
    expect(said).toContain("Includes 50");
    expect(said).toContain("Includes 10 given away to nobody.");
    expect(said).toContain("set to tax every turn");
  });

  it("the silver popup keeps the taxing note for a unit that taxes nothing", () => {
    const popup = columnPopup(
      popupForCell(
        "silver",
        unit({ own: true }),
        facts({
          silver: aUnitSilver({
            held: 100,
            atMonthEnd: 60,
            taxesByFlag: true,
            changes: [{ amount: -40, cause: "studied", line: 2, other: null }]
          })
        })
      )
    );
    expect(popup.notes.join(" ")).toContain("set to tax every turn");
  });

  it("the silver popup draws no line for a cause whose movements cancel", () => {
    const popup = columnPopup(
      popupForCell(
        "silver",
        unit({ own: true }),
        facts({
          silver: aUnitSilver({
            held: 100,
            atMonthEnd: 100,
            changes: [
              { amount: 40, cause: "was-given", line: null, other: "Watch (1604)" },
              { amount: -40, cause: "was-given", line: null, other: "Scouts (1502)" }
            ]
          })
        })
      )
    );
    expect(popup.lines).toEqual([{ label: "silver", value: "100" }]);
  });

  it("the silver popup says a doubted month cannot be added up", () => {
    const popup = columnPopup(
      popupForCell(
        "silver",
        unit({ own: true }),
        facts({
          silver: aUnitSilver({
            held: 100,
            atMonthEnd: null,
            doubt: "unknown-tax-base",
            changes: []
          })
        })
      )
    );
    expect(popup.lines).toEqual([{ label: "silver", value: "?" }]);
    expect(popup.notes[0]).toBe(
      "This month cannot be added up, so what moved this unit's silver is not listed."
    );
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
        { label: "silver SILV", value: "40", change: { direction: "up", from: "36" } },
        {
          label: "grain GRAI",
          value: "2",
          change: { direction: "down", from: "3" },
          why: "1 eaten"
        }
      ],
      notes: ["was: 36 SILV, 3 GRAI."],
      warning: "This month is only partly counted."
    });
    expect(text).toBe(
      "silver SILV 40, up from 36. grain GRAI 2, down from 3, 1 eaten. was: 36 SILV, 3 GRAI. This month is only partly counted."
    );
  });

  it("says nothing about a change a line does not carry", () => {
    expect(
      popupAsText({ title: "x", lines: [{ label: "men", value: "12" }], notes: [], warning: null })
    ).toBe("men 12.");
  });
});

describe("the skills popup's chain and its sentences (ah-rgkk.2.3)", () => {
  const skill = (name: string, tag: string, level: number, points: number) => ({
    name,
    tag,
    level,
    points
  });

  const own = (overrides: Partial<PreviewedUnit> = {}) =>
    unit({ own: true, previewChanges: [{ field: "skills", original: "COMB 2 (90)" }], ...overrides });

  const skillsPopup = (u: PreviewedUnit, f = facts()) =>
    columnPopup(popupForCell("skills", u, f));

  const forecast = (overrides: Partial<StudyForecast> = {}): StudyForecast => ({
    tag: "COMB",
    name: "combat",
    levelBefore: 1,
    pointsBefore: 53,
    monthsNumerator: 1,
    monthsDenominator: 1,
    teachers: [],
    halvedOutsideABuilding: false,
    pointsAfter: 98,
    levelAfter: 2,
    ceilingLevel: 5,
    limitingRaces: [],
    heldBackByCeiling: false,
    doubts: [],
    ...overrides
  });

  it("the skills popup draws what the report said and what the market left", () => {
    const popup = skillsPopup(
      own({
        reportedSkills: [skill("combat", "COMB", 2, 90)],
        skills: [skill("combat", "COMB", 1, 53)]
      })
    );
    expect(popup.lines).toEqual([
      {
        label: "combat COMB",
        value: "1 (53)",
        steps: [
          { value: "2 (90)", mark: "reported" },
          { value: "1 (53)", mark: "down" }
        ]
      }
    ]);
  });

  it("the skills popup draws one figure for a skill this month did not touch", () => {
    const popup = skillsPopup(
      own({
        reportedSkills: [skill("combat", "COMB", 2, 90)],
        skills: [skill("combat", "COMB", 2, 90)]
      })
    );
    expect(popup.lines).toEqual([{ label: "combat COMB", value: "2 (90)" }]);
  });

  it("the skills popup draws one figure for a unit the orders left alone", () => {
    const popup = skillsPopup(
      unit({ own: true, skills: [skill("combat", "COMB", 2, 90)] })
    );
    expect(popup.lines).toEqual([{ label: "combat COMB", value: "2 (90)" }]);
  });

  it("a skill diluted out of the list ends its chain at gone", () => {
    const popup = skillsPopup(
      own({
        reportedSkills: [skill("combat", "COMB", 1, 30), skill("riding", "RIDI", 1, 30)],
        skills: [skill("combat", "COMB", 0, 6)]
      })
    );
    expect(popup.lines[1]).toEqual({
      label: "riding RIDI",
      value: "gone",
      steps: [
        { value: "1 (30)", mark: "reported" },
        { value: "gone", mark: "down" }
      ]
    });
    expect(popup.notes).toContain("Riding drops below one point per man, so the unit loses it.");
  });

  it("a skill the arriving men brought starts its chain at none", () => {
    const popup = skillsPopup(
      own({
        reportedSkills: [skill("combat", "COMB", 2, 90)],
        skills: [skill("combat", "COMB", 1, 53), skill("observation", "OBSE", 0, 25)]
      })
    );
    expect(popup.lines[1]!.steps).toEqual([
      { value: "none", mark: "reported" },
      { value: "0 (25)", mark: "up" }
    ]);
  });

  it("the skills popup keeps the report's order, not the core's tag order", () => {
    const popup = skillsPopup(
      own({
        reportedSkills: [skill("lumberjack", "LUMB", 2, 90), skill("combat", "COMB", 2, 90)],
        skills: [skill("combat", "COMB", 1, 53), skill("lumberjack", "LUMB", 1, 53)]
      })
    );
    expect(popup.lines.map((line) => line.label)).toEqual(["lumberjack LUMB", "combat COMB"]);
  });

  it("the skills popup says who joined and what they brought", () => {
    const popup = skillsPopup(
      own({
        reportedSkills: [skill("combat", "COMB", 2, 90)],
        skills: [skill("combat", "COMB", 1, 53)],
        skillMerges: [
          {
            cause: "given",
            from: "1502",
            men: 2,
            menBefore: 4,
            menArriving: [],
            countInferred: false,
            arrivingSkills: [skill("observation", "OBSE", 3, 180)],
            skills: []
          }
        ]
      }),
      facts({ unitNames: new Map([["1502", "Scouts"]]) })
    );
    expect(popup.notes).toContain("2 men joined from Scouts (1502), bringing observation 3.");
  });

  it("the skills popup names a giver the table is not drawing", () => {
    const popup = skillsPopup(
      own({
        reportedSkills: [skill("combat", "COMB", 2, 90)],
        skills: [skill("combat", "COMB", 1, 53)],
        skillMerges: [
          {
            cause: "given",
            from: "1502",
            men: 2,
            menBefore: 4,
            menArriving: [],
            countInferred: false,
            arrivingSkills: [],
            skills: []
          }
        ]
      })
    );
    expect(popup.notes).toContain("2 men joined from unit 1502.");
  });

  it("the skills popup says recruits bring nothing", () => {
    const merge = (overrides = {}) => ({
      cause: "recruited" as const,
      from: "",
      men: 6,
      menBefore: 4,
      menArriving: [{ amount: 6, name: "human", tag: "HUMN" }],
      countInferred: false,
      arrivingSkills: [],
      skills: [],
      ...overrides
    });
    expect(
      skillsPopup(own({ reportedSkills: [], skills: [], skillMerges: [merge()] })).notes
    ).toContain("6 humans recruited, and recruits bring no skills.");
    expect(
      skillsPopup(
        own({
          reportedSkills: [],
          skills: [],
          skillMerges: [merge({ menArriving: [], countInferred: true })]
        })
      ).notes
    ).toContain("6 men recruited, and recruits bring no skills.");
  });

  it("the skills popup names men whose own skills the report does not show", () => {
    const popup = skillsPopup(
      own({
        reportedSkills: [skill("combat", "COMB", 2, 90)],
        skills: [skill("combat", "COMB", 1, 53)],
        menOfUnknownSkill: [{ amount: 3, tag: "HUMN", from: "1502" }]
      }),
      facts({ unitNames: new Map([["1502", "Scouts"]]) })
    );
    expect(popup.notes).toContain(
      "3 men came from Scouts (1502), whose skills the report does not show, so these figures do not count them."
    );
  });

  it("the skills popup says when an estimated headcount stopped the dilution being worked out", () => {
    const popup = skillsPopup(
      own({
        reportedSkills: [skill("combat", "COMB", 2, 90)],
        skills: [skill("combat", "COMB", 2, 90)],
        recruitsUnmerged: true
      })
    );
    expect(popup.warning).toBe(
      "This unit's headcount is a guess, so what recruiting does to these cannot be worked out."
    );
  });

  it("the skills popup ends a studied skill's chain in next turn's figure", () => {
    const popup = skillsPopup(
      own({
        reportedSkills: [skill("combat", "COMB", 2, 90)],
        skills: [skill("combat", "COMB", 1, 53)],
        study: forecast({
          monthsNumerator: 3,
          monthsDenominator: 2,
          teachers: [{ unitId: "1774", name: "Elders", slots: 10, students: 5 }]
        })
      })
    );
    expect(popup.lines[0]!.steps![2]).toEqual({ value: "2 (98)", mark: "projected" });
    expect(popup.notes).toContain(
      "Studying combat, taught by Elders (1774): worth one and a half months. The blue figure is next turn's report; everything before it is this month."
    );
  });

  it("the skills popup gives a studied skill a line of its own when the unit has never held it", () => {
    const popup = skillsPopup(
      own({
        reportedSkills: [],
        skills: [],
        study: forecast({ tag: "RIDI", name: "riding", levelAfter: 1, pointsAfter: 30 })
      })
    );
    expect(popup.lines[0]!.label).toBe("riding RIDI");
    expect(popup.lines[0]!.steps).toEqual([
      { value: "none", mark: "reported" },
      { value: "1 (30)", mark: "projected" }
    ]);
  });

  it("the skills popup says what the race ceiling holds back", () => {
    const popup = skillsPopup(
      own({
        reportedSkills: [skill("combat", "COMB", 1, 53)],
        skills: [skill("combat", "COMB", 1, 53)],
        study: forecast({
          heldBackByCeiling: true,
          ceilingLevel: 2,
          limitingRaces: [{ tag: "HDWA", name: "hill dwarf" }]
        })
      })
    );
    expect(popup.notes.join(" ")).toContain(
      "Studying combat: worth one month. No hill dwarf may take combat past level 2, so the points rise and the level holds."
    );
  });

  it("the skills popup says a magic month spent outside a building is half a month", () => {
    const popup = skillsPopup(
      own({
        reportedSkills: [skill("force", "FORC", 1, 53)],
        skills: [skill("force", "FORC", 1, 53)],
        study: forecast({
          tag: "FORC",
          name: "force",
          halvedOutsideABuilding: true,
          monthsNumerator: 1,
          monthsDenominator: 2
        })
      })
    );
    expect(popup.notes.join(" ")).toContain(
      "Studying force: worth half a month. Studying a magic skill past level 2 outside a building that houses mages, so half the month is lost."
    );
  });

  it("a month worth no round fraction is said as a figure", () => {
    const popup = skillsPopup(
      own({
        reportedSkills: [skill("combat", "COMB", 1, 53)],
        skills: [skill("combat", "COMB", 1, 53)],
        study: forecast({ monthsNumerator: 10, monthsDenominator: 13 })
      })
    );
    expect(popup.notes.join(" ")).toContain("worth 0.77 months.");
  });

  it("a doubted projection carries a question mark and says what the doubt is", () => {
    const popup = skillsPopup(
      own({
        reportedSkills: [skill("combat", "COMB", 1, 53)],
        skills: [skill("combat", "COMB", 1, 53)],
        study: forecast({
          doubts: [{ reason: "feeShort", fee: 200, shortBy: 160, teacher: "" }]
        })
      })
    );
    expect(popup.lines[0]!.steps![1]).toEqual({
      value: "2 (98)",
      mark: "projected",
      uncertain: true
    });
    expect(popup.warning).toBe(
      "Studying combat costs 200 silver and this unit is 160 short, so the study may not happen at all."
    );
  });

  it("every doubt has its own sentence", () => {
    const warningFor = (doubt: StudyDoubt) =>
      skillsPopup(
        own({
          reportedSkills: [skill("combat", "COMB", 1, 53)],
          skills: [skill("combat", "COMB", 1, 53)],
          study: forecast({ doubts: [doubt] })
        })
      ).warning;
    const doubt = (overrides: Partial<StudyDoubt>): StudyDoubt => ({
      reason: "feeShort",
      fee: 0,
      shortBy: 0,
      teacher: "",
      ...overrides
    });
    expect(warningFor(doubt({ reason: "feeShort", fee: 200, shortBy: 160 }))).toBe(
      "Studying combat costs 200 silver and this unit is 160 short, so the study may not happen at all."
    );
    expect(warningFor(doubt({ reason: "feeUnpriced" }))).toBe(
      "The data page prices combat nowhere, so what studying it costs cannot be said."
    );
    expect(warningFor(doubt({ reason: "headcountEstimated" }))).toBe(
      "This unit's headcount is a guess, so recruiting may pull these back below what is shown."
    );
    expect(warningFor(doubt({ reason: "teacherUnsettled", teacher: "Elders (1774)" }))).toBe(
      "Whether Elders (1774) may teach cannot be settled from this report, so its month is not counted here."
    );
    expect(
      warningFor(doubt({ reason: "teacherStudentsUnknown", teacher: "Elders (1774)" }))
    ).toBe(
      "Elders (1774) also teaches a unit of another faction whose headcount the report does not show, so how far its teaching spreads cannot be said."
    );
    expect(warningFor(doubt({ reason: "shelterUnknown" }))).toBe(
      "This unit ends the month in a structure this region's report does not list, so whether it shelters a mage cannot be said."
    );
  });

  it("an estimated headcount is said once, not twice", () => {
    const popup = skillsPopup(
      own({
        reportedSkills: [skill("combat", "COMB", 1, 53)],
        skills: [skill("combat", "COMB", 1, 53)],
        recruitsUnmerged: true,
        study: forecast({
          doubts: [{ reason: "headcountEstimated", fee: 0, shortBy: 0, teacher: "" }]
        })
      })
    );
    expect(popup.warning).toBe(
      "This unit's headcount is a guess, so what recruiting does to these cannot be worked out."
    );
  });

  it("a chain reads as figures and directions, not as arrows", () => {
    expect(
      popupAsText({
        title: "Braves (1487) — skills",
        lines: [
          {
            label: "combat COMB",
            value: "1 (53)",
            steps: [
              { value: "2 (90)", mark: "reported" },
              { value: "1 (53)", mark: "down" },
              { value: "2 (98)", mark: "projected" }
            ]
          }
        ],
        notes: [],
        warning: null
      })
    ).toBe("combat COMB 2 (90), down to 1 (53), 2 (98) next turn.");
    expect(
      popupAsText({
        title: "Braves (1487) — skills",
        lines: [
          {
            label: "combat COMB",
            value: "1 (53)",
            steps: [
              { value: "1 (53)", mark: "reported" },
              { value: "2 (98)", mark: "projected", uncertain: true }
            ]
          }
        ],
        notes: [],
        warning: null
      })
    ).toBe("combat COMB 1 (53), 2 (98) next turn if it happens.");
  });

  it("a skill at its own maximum names the skill, not a race", () => {
    const popup = skillsPopup(
      own({
        reportedSkills: [skill("combat", "COMB", 5, 450)],
        skills: [skill("combat", "COMB", 5, 450)],
        study: forecast({
          levelAfter: 5,
          pointsAfter: 500,
          heldBackByCeiling: true,
          ceilingLevel: 5,
          limitingRaces: []
        })
      })
    );
    expect(popup.notes.join(" ")).toContain(
      "Combat stops at level 5, so the points rise and the level holds."
    );
  });

  it("an own unit with nothing to draw still says it has no skills", () => {
    const popup = skillsPopup(unit({ own: true, skills: [] }));
    expect(popup.lines).toEqual([]);
    expect(popup.notes).toContain("No skills.");
  });

  it("an own unit with no skills at all still gets a line for what it is studying", () => {
    const popup = skillsPopup(
      own({
        reportedSkills: [],
        skills: [],
        study: forecast({ tag: "RIDI", name: "riding", levelAfter: 1, pointsAfter: 30 })
      })
    );
    expect(popup.lines[0]!.label).toBe("riding RIDI");
    expect(popup.notes).not.toContain("No skills.");
  });

  it("the study note promises no blue figure the twelve-line cap has taken away", () => {
    const many = Array.from({ length: 12 }, (_, index) => ({
      name: `skill${index}`,
      tag: `SK${index}`,
      level: 1,
      points: 30
    }));
    const popup = skillsPopup(
      own({
        reportedSkills: many,
        skills: many,
        study: forecast({ tag: "RIDI", name: "riding", levelAfter: 1, pointsAfter: 30 })
      })
    );
    expect(popup.lines).toHaveLength(12);
    expect(popup.notes.join(" ")).not.toContain("The blue figure is next turn's report");
  });
});

describe("reportedItems", () => {
  it("reads the report's own figure for each item off the items change", () => {
    expect(reportedItems("20 SILV, 3 GRAI")).toEqual(
      new Map([
        ["SILV", 20],
        ["GRAI", 3]
      ])
    );
  });

  it("reads an empty original as the report saying the unit held nothing", () => {
    expect(reportedItems("")).toEqual(new Map());
  });

  it("gives up on an original it cannot parse", () => {
    expect(reportedItems("was: 20 SILV")).toBeUndefined();
    expect(reportedItems("~8 SWOR")).toBeUndefined();
  });
});

describe("the items popup's pairs", () => {
  it("pairs each item with what the report said", () => {
    const popup = columnPopup(
      popupForCell(
        "items",
        unit({
          items: [{ name: "sword", tag: "SWOR", amount: 12 }],
          previewChanges: [{ field: "items", original: "8 SWOR" }]
        }),
        facts()
      )
    );
    expect(popup.lines).toEqual([
      { label: "sword SWOR", value: "12", change: { direction: "up", from: "8" } }
    ]);
  });

  it("an item the unit no longer holds ends at gone", () => {
    const popup = columnPopup(
      popupForCell(
        "items",
        unit({
          items: [],
          previewChanges: [{ field: "items", original: "20 SILV" }],
          itemChanges: [
            {
              tag: "SILV",
              name: "silver",
              delta: -20,
              cause: "given-away",
              line: 3,
              unitPrice: null,
              other: { unitId: "1502", name: "Scouts" },
              isMan: false
            }
          ]
        }),
        facts()
      )
    );
    expect(popup.lines).toEqual([
      { label: "silver SILV", value: "gone", change: { direction: "down", from: "20" } }
    ]);
    expect(popup.notes).not.toContain("No items.");
  });

  it("an item the report never listed starts at none", () => {
    const popup = columnPopup(
      popupForCell(
        "items",
        unit({
          items: [{ name: "sword", tag: "SWOR", amount: 4 }],
          previewChanges: [{ field: "items", original: "" }]
        }),
        facts()
      )
    );
    expect(popup.lines).toEqual([
      { label: "sword SWOR", value: "4", change: { direction: "up", from: "none" } }
    ]);
  });

  it("doubles a tag that is its own display name, as it always did", () => {
    const popup = columnPopup(
      popupForCell("items", unit({ items: [{ name: "SILV", tag: "SILV", amount: 4 }] }), facts())
    );
    expect(popup.lines).toEqual([{ label: "SILV SILV", value: "4" }]);
  });

  it("draws a cast item's range exactly as the cell does", () => {
    const popup = columnPopup(
      popupForCell(
        "items",
        unit({
          items: [{ name: "iron", tag: "IRON", amount: 5 }],
          created: [{ fewest: 2, most: 5, tag: "IRON", summoned: false }]
        }),
        facts()
      )
    );
    expect(popup.lines).toEqual([{ label: "iron IRON", value: "2-5" }]);
  });

  it("quotes the report's own words when the change cannot be parsed", () => {
    const popup = columnPopup(
      popupForCell(
        "items",
        unit({
          items: [{ name: "sword", tag: "SWOR", amount: 12 }],
          previewChanges: [{ field: "items", original: "~8 SWOR" }]
        }),
        facts()
      )
    );
    expect(popup.lines).toEqual([{ label: "sword SWOR", value: "12", why: "was: ~8 SWOR" }]);
  });
});

describe("the items popup's order", () => {
  const change = (tag: string, delta: number) => ({
    tag,
    name: tag.toLowerCase(),
    delta,
    cause: "produced" as const,
    line: null,
    unitPrice: null,
    other: null,
    isMan: false
  });

  it("draws every item this month moved before the ones it did not", () => {
    // Fifteen tags, of which the two smallest moved: without the moved-first rule both would fall
    // outside the twelve lines the popup draws.
    const tags = Array.from({ length: 15 }, (_, i) => `T${String(i).padStart(2, "0")}`);
    const popup = columnPopup(
      popupForCell(
        "items",
        unit({
          items: tags.map((tag, i) => ({ name: tag.toLowerCase(), tag, amount: 100 - i })),
          itemChanges: [change("T13", 1), change("T14", 1)]
        }),
        facts()
      )
    );
    expect(popup.lines.slice(0, 2).map((line) => line.label)).toEqual(["t13 T13", "t14 T14"]);
    // The rest keep the cell's own amount-descending order.
    expect(popup.lines.slice(2).map((line) => line.label)).toEqual(
      tags.slice(0, 10).map((tag) => `${tag.toLowerCase()} ${tag}`)
    );
  });

  it("puts the moved items in the month's own order", () => {
    const popup = columnPopup(
      popupForCell(
        "items",
        unit({
          items: [
            { name: "grain", tag: "GRAI", amount: 40 },
            { name: "wood", tag: "WOOD", amount: 2 }
          ],
          itemChanges: [change("WOOD", 2), change("GRAI", 1)]
        }),
        facts()
      )
    );
    expect(popup.lines.map((line) => line.label)).toEqual(["wood WOOD", "grain GRAI"]);
  });

  it("keeps an unmoved item behind a moved one when a tag moved more than once", () => {
    // The month's order is the order tags *first* appear, not the raw index of each change: a tag
    // bought at three prices writes three entries, and ranking on the raw index would push a later
    // moved tag past the unmoved block.
    const popup = columnPopup(
      popupForCell(
        "items",
        unit({
          items: [
            { name: "zinc", tag: "ZINC", amount: 90 },
            { name: "grain", tag: "GRAI", amount: 3 },
            { name: "bread", tag: "BREA", amount: 1 }
          ],
          itemChanges: [
            change("GRAI", 1),
            change("GRAI", 1),
            change("GRAI", 1),
            change("BREA", 1)
          ]
        }),
        facts()
      )
    );
    expect(popup.lines.map((line) => line.label)).toEqual([
      "grain GRAI",
      "bread BREA",
      "zinc ZINC"
    ]);
  });

  it("keeps an item whose movement the core did not record in the moved block", () => {
    const popup = columnPopup(
      popupForCell(
        "items",
        unit({
          items: [
            { name: "grain", tag: "GRAI", amount: 40 },
            { name: "wood", tag: "WOOD", amount: 5 }
          ],
          previewChanges: [{ field: "items", original: "40 GRAI, 2 WOOD" }]
        }),
        facts()
      )
    );
    expect(popup.lines.map((line) => line.label)).toEqual(["wood WOOD", "grain GRAI"]);
  });
});

describe("the items popup's cause sentences", () => {
  const moved = (
    overrides: Partial<{
      tag: string;
      name: string;
      delta: number;
      cause: string;
      line: number | null;
      unitPrice: number | null;
      other: { unitId: string; name: string | null } | null;
    }> = {}
  ) =>
    ({
      tag: "GRAI",
      name: "grain",
      delta: -1,
      cause: "sold",
      line: null,
      unitPrice: null,
      other: null,
      isMan: false,
      ...overrides
    }) as NonNullable<PreviewedUnit["itemChanges"]>[number];

  const notesFor = (overrides: Partial<PreviewedUnit>) =>
    columnPopup(popupForCell("items", unit(overrides), facts())).notes;

  it("names every movement of one item in a single sentence", () => {
    expect(
      notesFor({
        items: [{ name: "grain", tag: "GRAI", amount: 8 }],
        itemChanges: [
          moved({ cause: "sold", delta: -12, unitPrice: 12 }),
          moved({
            cause: "transported-out",
            delta: -20,
            other: { unitId: "4102", name: "Ferry" }
          })
        ]
      })[0]
    ).toBe("grain: sold 12 at 12 silver each, sent 20 to Ferry (4102).");
  });

  const cases: Array<[string, Parameters<typeof moved>[0], string]> = [
    ["bought with a price", { cause: "bought", delta: 4, unitPrice: 60 }, "bought 4 at 60 silver each"],
    ["bought without one", { cause: "bought", delta: 4 }, "bought 4"],
    ["sold without a price", { cause: "sold", delta: -12 }, "sold 12"],
    ["withdrawn", { cause: "withdrawn", delta: 10 }, "withdrew 10 from the faction's stores"],
    ["produced", { cause: "produced", delta: 5 }, "produced 5"],
    [
      "spent on another unit's production",
      { cause: "production-spent", delta: -3, other: { unitId: "1487", name: "Braves" } },
      "used 3 for Braves (1487) to produce"
    ],
    ["spent as material", { cause: "production-spent", delta: -3 }, "used 3 as material"],
    [
      "spent on another unit's build",
      { cause: "build-spent", delta: -10, other: { unitId: "1487", name: "Braves" } },
      "spent 10 for Braves (1487) to build"
    ],
    ["consumed by a spell", { cause: "cast-spent", delta: -2 }, "consumed 2 by a spell"],
    [
      "transported to a unit the report does not show",
      { cause: "transported-out", delta: -20, other: { unitId: "4102", name: null } },
      "sent 20 to unit 4102, which your report does not show"
    ],
    [
      "transported in",
      { cause: "transported-in", delta: 20, other: { unitId: "1913", name: "Porters" } },
      "received 20 from Porters (1913)"
    ],
    [
      "abandoned",
      { cause: "abandoned", delta: -4 },
      "left behind, unfinished, when the unit leaves the hex"
    ],
    [
      "given away",
      { cause: "given-away", delta: -2, other: { unitId: "1502", name: "Scouts" } },
      "gave 2 to Scouts (1502)"
    ],
    ["given to a foreign faction", { cause: "given-away", delta: -2 }, "gave 2 to another faction"],
    [
      "given to it",
      { cause: "was-given", delta: 30, other: { unitId: "1774", name: "Elders" } },
      "given 30 by Elders (1774)"
    ],
    [
      "taken",
      { cause: "took", delta: 3, other: { unitId: "1604", name: "Watch" } },
      "took 3 from Watch (1604)"
    ],
    [
      "taken from it",
      { cause: "was-taken-from", delta: -3, other: { unitId: "1604", name: "Watch" } },
      "3 taken by Watch (1604)"
    ],
    ["discarded", { cause: "discarded", delta: -5 }, "discarded 5"],
    [
      "reverted",
      { cause: "gift-reverted", delta: -2 },
      "2 reverted from a unit that formed with nobody"
    ],
    ["a cause it has not been taught", { cause: "unheard-of", delta: 4 }, "gained 4"],
    ["a loss it has not been taught", { cause: "unheard-of", delta: -4 }, "lost 4"]
  ];

  for (const [name, change, clause] of cases) {
    it(`says ${name} as “${clause}”`, () => {
      expect(
        notesFor({
          items: [{ name: "grain", tag: "GRAI", amount: 8 }],
          itemChanges: [moved(change)]
        })[0]
      ).toBe(`grain: ${clause}.`);
    });
  }

  it("names the structure a build spend went into", () => {
    expect(
      notesFor({
        items: [{ name: "wood", tag: "WOOD", amount: 2 }],
        itemChanges: [moved({ tag: "WOOD", name: "wood", cause: "build-spent", delta: -10 })],
        built: [
          {
            amount: 10,
            tag: "WOOD",
            name: "wood",
            place: "Fort",
            founding: false,
            helping: null,
            couldDo: 10,
            cappedBy: null
          }
        ]
      })[0]
    ).toBe("wood: spent 10 on Fort.");
  });

  it("falls back to a bare build when it cannot match the spend", () => {
    expect(
      notesFor({
        items: [{ name: "wood", tag: "WOOD", amount: 2 }],
        itemChanges: [moved({ tag: "WOOD", name: "wood", cause: "build-spent", delta: -10 })]
      })[0]
    ).toBe("wood: spent 10 on a build.");
  });

  it("says a summoned item was summoned, and gives its range", () => {
    expect(
      notesFor({
        items: [{ name: "imp", tag: "IMP", amount: 3 }],
        created: [{ fewest: 1, most: 3, tag: "IMP", summoned: true }],
        itemChanges: [moved({ tag: "IMP", name: "imp", cause: "cast-created", delta: 3 })]
      })[0]
    ).toBe("imp: summoned 1-3.");
  });

  it("says an item made by casting was created by casting", () => {
    expect(
      notesFor({
        items: [{ name: "iron", tag: "IRON", amount: 3 }],
        created: [{ fewest: 3, most: 3, tag: "IRON", summoned: false }],
        itemChanges: [moved({ tag: "IRON", name: "iron", cause: "cast-created", delta: 3 })]
      })[0]
    ).toBe("iron: created 3 by casting.");
  });

  it("says a transport with no other unit as a bare send", () => {
    expect(
      notesFor({
        items: [{ name: "grain", tag: "GRAI", amount: 8 }],
        itemChanges: [moved({ cause: "transported-out", delta: -20 })]
      })[0]
    ).toBe("grain: sent 20.");
  });

  it("says an arrival with no other unit as a bare receipt", () => {
    expect(
      notesFor({
        items: [{ name: "grain", tag: "GRAI", amount: 28 }],
        itemChanges: [moved({ cause: "transported-in", delta: 20 })]
      })[0]
    ).toBe("grain: received 20.");
  });

  it("adds up a tag two casts create", () => {
    expect(
      notesFor({
        items: [{ name: "wolf", tag: "WOLF", amount: 8 }],
        created: [
          { fewest: 1, most: 4, tag: "WOLF", summoned: true },
          { fewest: 2, most: 4, tag: "WOLF", summoned: true }
        ],
        itemChanges: [moved({ tag: "WOLF", name: "wolf", cause: "cast-created", delta: 8 })]
      })[0]
    ).toBe("wolf: summoned 3-8.");
  });

  it("says nothing about an item the cap never drew", () => {
    // S2 promises the prose block can never be longer than the list above it, so a sentence for a
    // figure the reader cannot see would break the density the decision was made for.
    const popup = columnPopup(
      popupForCell(
        "items",
        unit({
          items: Array.from({ length: 14 }, (_, i) => ({
            name: `t${i}`,
            tag: `T${String(i).padStart(2, "0")}`,
            amount: 100 - i
          })),
          itemChanges: Array.from({ length: 14 }, (_, i) =>
            moved({ tag: `T${String(i).padStart(2, "0")}`, name: `t${i}`, cause: "produced", delta: 1 })
          )
        }),
        facts()
      )
    );
    expect(popup.lines).toHaveLength(12);
    expect(popup.notes.filter((note) => /^t\d+:/.test(note))).toHaveLength(12);
    expect(popup.notes.some((note) => note.startsWith("t13:"))).toBe(false);
  });

  it("an item whose movement the core did not record gets no sentence", () => {
    const notes = notesFor({
      items: [{ name: "grain", tag: "GRAI", amount: 12 }],
      previewChanges: [{ field: "items", original: "8 GRAI" }]
    });
    expect(notes.filter((note) => note.startsWith("grain:"))).toEqual([]);
  });
});
