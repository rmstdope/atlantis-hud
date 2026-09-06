import type { ReportUnit, StudyDoubt, StudyForecast } from "@atlantis/core-client";
import { aReportUnit, aUnitSilver } from "@atlantis/core-client";
import { describe, expect, it } from "vitest";
import type { PreviewedUnit } from "./unitPreview";
import {
  columnHasPopup,
  popupAsText,
  popupForCell,
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
              other: { unitId: "1502", name: "Scouts" }
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
