import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import type {
  ArmyMemberRecord,
  ArmyRecord,
  OrdersPreviewResponse,
  RegionPreview,
  ReportRegion,
  ReportUnit,
  UnitMovement,
  UnitSilver
} from "@atlantis/core-client";
import { aReportRegion, aReportUnit, aUnitSilver } from "@atlantis/core-client";
import type { HexNode } from "../hexMapModel";
import {
  DEFAULT_COLUMN_SHARES,
  allColumnsShown,
  silverKey,
  UNIT_COLUMNS,
  unitRowKey,
  type UnitColumn
} from "../unitTable";
import { renderWithStoreState, restoreStoresForTest, setStoreStateForTest } from "../testing/storeState";
import { resetWorkspaceStore, useWorkspaceStore } from "../workspaceStore";
import { useArmiesStore } from "../armiesStore";
import { UnitTableDock } from "./UnitTableDock";
import { FOREIGN_SOURCE } from "./unitSource";

/**
 * A hex's units pane, as markup.
 *
 * The repository has no jsdom, so scrolling and pointer behaviour are the smoke suite's job; what
 * is checkable here is what the pane says when it has nothing to show, which is the part ah-o86
 * changed: a stale hex's empty list must not read as a genuinely empty hex.
 */
const region = (overrides: Partial<ReportRegion> = {}): ReportRegion =>
  aReportRegion({ regionId: "1:6,52", coordinate: { x: 6, y: 52, z: 1 }, terrain: "tundra", province: "Farside", ...overrides });

function hex(overrides: Partial<HexNode> = {}): HexNode {
  return {
    regionId: "1:6,52",
    coordinate: { x: 6, y: 52, z: 1 },
    terrain: "tundra",
    province: "Farside",
    label: "tundra (6,52) in Farside",
    knowledge: "current",
    lastSeenTurn: 42,
    ageInTurns: 0,
    settlementName: null,
    region: region(),
    ownUnitCount: 0,
    foreignUnitCount: 0,
    ...overrides
  };
}

function draw(node: HexNode | null, preview: RegionPreview | null = null): string {
  return renderToStaticMarkup(<UnitTableDock hex={node} preview={preview} />);
}

const unit = (overrides: Partial<ReportUnit> = {}): ReportUnit =>
  aReportUnit({ unitId: "1", name: "Scout", regionId: "1:6,52", factionId: "1", factionName: "My Faction", ...overrides });

const WALKING: UnitMovement = {
  status: "walk",
  load: 10,
  fly: 0,
  ride: 0,
  walk: 15,
  capacityMode: "walk"
};

describe("the units pane on an empty hex", () => {
  it("a stale hex explains its empty list instead of claiming an empty hex", () => {
    const markup = draw(hex({ knowledge: "stale", lastSeenTurn: 21, region: region({ units: [] }) }));

    expect(markup).toContain("Not seen since turn 21 — no current unit information.");
    expect(markup).not.toContain("No units reported in this hex.");
  });

  it("a stale hex's header names the ground but counts nothing", () => {
    const markup = draw(hex({ knowledge: "stale", lastSeenTurn: 21, region: region({ units: [] }) }));

    // The hint text itself, wherever the header happens to wrap it: everything from the em dash up
    // to the next tag boundary. Asserted this way rather than against a specific element's classes,
    // so a harmless markup or styling change cannot break this test over text that stayed right.
    const hint = /—[^<]*/.exec(markup)?.[0];

    expect(hint).toBe("— tundra (6,52)");
  });

  it("an empty current hex keeps today's line", () => {
    const markup = draw(hex({ knowledge: "current", lastSeenTurn: 42, region: region({ units: [] }) }));

    expect(markup).toContain("No units reported in this hex.");
    expect(markup).not.toContain("Not seen since turn");
  });
});

describe("the dock stops sizing itself", () => {
  it("the scroller carries no height of its own", () => {
    const markup = draw(
      hex({
        knowledge: "current",
        lastSeenTurn: 42,
        region: region({ units: [unit({ unitId: "1" }), unit({ unitId: "2" })] })
      })
    );

    // The scroller's own class carries no style attribute at all now - the slot around it owns
    // the height. Rows still carry their own fixed "height:22px", which is unrelated. Matched by
    // the classes it must carry rather than the whole attribute value, so a harmless class added
    // later cannot break this over behaviour that still holds.
    const scroller = /<div[^>]*class="[^"]*overflow-y-scroll[^"]*"[^>]*>/.exec(markup)?.[0];
    expect(scroller).toBeDefined();
    expect(scroller).toContain("h-full");
    expect(scroller).toContain("overflow-x-hidden");
    expect(scroller).not.toContain("style=");
  });

  it("an empty hex is a message, not a reserved box", () => {
    const markup = draw(hex({ knowledge: "current", lastSeenTurn: 42, region: region({ units: [] }) }));

    expect(markup).toContain("No units reported in this hex.");
    expect(markup).not.toContain('style="height:');
  });
});


describe("a unit carried away by a sailing fleet", () => {
  const carried = (aboard: string | null, departingTo: string | null): RegionPreview => ({
    regionId: "1:6,52",
    units: [
      {
        unit: unit({ unitId: "901", name: "Passengers", structureId: "329" }),
        status: "departing",
        changes: [],
        arrivingFrom: null,
        departingTo,
        aboard,
        uncounted: [],
        takenUnshown: [],
        produced: [],
        built: [],
        created: [],
        transportSent: [],
        transportReceived: [],
        transportTargetIssues: []
      }
    ]
  });

  it("names the fleet that takes it, beside where it is bound", () => {
    const markup = draw(
      hex({ region: region({ units: [unit({ unitId: "901", name: "Passengers", structureId: "329" })] }) }),
      carried("Wavecrest [329]", "1:7,53")
    );

    expect(markup).toContain("→ 1:7,53");
    expect(markup).toContain("aboard Wavecrest [329]");
  });

  it("still names the fleet when the ship's destination cannot be named", () => {
    const markup = draw(
      hex({ region: region({ units: [unit({ unitId: "901", name: "Passengers", structureId: "329" })] }) }),
      carried("Wavecrest [329]", null)
    );

    expect(markup).toContain("→ …");
    expect(markup).toContain("aboard Wavecrest [329]");
  });
});

describe("the structure column", () => {
  const WAVECREST = {
    structureId: "329",
    name: "Wavecrest",
    kind: "Longship", baseKind: "Longship", qualifiers: [], vessels: [],
    description: null,
    needs: null
  };

  const inStructures = (units: ReportUnit[]) =>
    hex({ region: region({ structures: [WAVECREST], units }) });

  it("names the structure a unit stands in, not just its number", () => {
    const markup = draw(inStructures([unit({ unitId: "901", name: "Passengers", structureId: "329" })]));

    expect(markup).toContain("Wavecrest [329] · Longship");
  });

  it("keeps the bare number when the region never described the structure", () => {
    const markup = draw(inStructures([unit({ unitId: "901", name: "Passengers", structureId: "77" })]));

    expect(markup).toContain("[77]");
    expect(markup).not.toContain("Wavecrest [77]");
  });

  it("leaves the cell empty for a unit standing in the open", () => {
    const markup = draw(inStructures([unit({ unitId: "902", name: "Scout", structureId: null })]));

    expect(markup).not.toContain("Wavecrest");
    // The structure cell renders with nothing in it at all. Long order and then Silver sit after
    // it (ah-1wcw.1), so the match runs through those two cells rather than to </tr> directly.
    expect(markup).toMatch(
      /<td[^>]*><\/td><td[^>]*>(<span class="text-danger">—<\/span>)?<\/td><td[^>]*><\/td><\/tr>/
    );
  });

  it("the tooltip gives the whole label, and what the orders changed beneath it", () => {
    const markup = draw(
      inStructures([unit({ unitId: "901", name: "Passengers", structureId: "329" })]),
      {
        regionId: "1:6,52",
        units: [
          {
            unit: unit({ unitId: "901", name: "Passengers", structureId: "329" }),
            status: "present",
            changes: [{ field: "structureId", original: "" }],
            arrivingFrom: null,
            departingTo: null,
            aboard: null,
            uncounted: [],
            takenUnshown: [],
            produced: [],
            built: [],
            created: [],
            transportSent: [],
            transportReceived: [],
            transportTargetIssues: []
          }
        ]
      }
    );

    expect(markup).toContain("Wavecrest [329] · Longship\n");
    expect(markup).toMatch(/title="Wavecrest \[329\] · Longship\n[^"]/);
  });
});

describe("draws its header and its rows from the column list", () => {
  const withUnits = () =>
    hex({ region: region({ units: [unit({ unitId: "1", own: true }), unit({ unitId: "2", own: false, factionId: "9", factionName: "Them" })] }), ownUnitCount: 1, foreignUnitCount: 1 });

  it("has one header cell and one column for every column in the list", () => {
    const markup = draw(withUnits());

    expect((markup.match(/<th\b/g) ?? []).length).toBe(UNIT_COLUMNS.length);
    expect((markup.match(/<col\b/g) ?? []).length).toBe(UNIT_COLUMNS.length);
  });

  it("gives every row exactly one cell per column", () => {
    const markup = draw(withUnits());
    const row = /<tr[^>]*data-testid="unit-row-1"[\s\S]*?<\/tr>/.exec(markup)?.[0] ?? "";

    expect((row.match(/<td\b/g) ?? []).length).toBe(UNIT_COLUMNS.length);
  });
});

describe("the Flags column (ah-5wbc)", () => {
  it("draws a unit's flags as one run of letters", () => {
    const markup = draw(
      hex({
        region: region({
          units: [
            unit({
              unitId: "1",
              own: true,
              flags: [
                "avoiding",
                "behind",
                "revealing faction",
                "holding",
                "sharing",
                "sailing battle spoils"
              ]
            })
          ]
        }),
        ownUnitCount: 1,
        foreignUnitCount: 0
      })
    );

    expect(markup).toContain(">ABHRS<");
    expect(markup).toContain("avoiding · behind · revealing faction · holding · sharing");
  });

  it("draws a dim dash for a unit with no flags", () => {
    const markup = draw(
      hex({
        region: region({ units: [unit({ unitId: "1", own: true, flags: [] })] }),
        ownUnitCount: 1,
        foreignUnitCount: 0
      })
    );

    expect(markup).toContain("No flags set");
    expect(markup).toMatch(/text-ink-dim[^>]*>\s*—/);
  });
});

describe("column widths (ah-1owr.2)", () => {
  const withUnits = () =>
    hex({ region: region({ units: [unit({ unitId: "1", own: true })] }), ownUnitCount: 1, foreignUnitCount: 0 });

  it("sizes every column from its share, as a percentage", () => {
    const markup = draw(withUnits());
    const cols = markup.match(/<col\b[^>]*>/g) ?? [];

    expect(cols).toHaveLength(UNIT_COLUMNS.length);
    cols.forEach((col, index) => {
      const column = UNIT_COLUMNS[index];
      expect(col).toContain(`width:${DEFAULT_COLUMN_SHARES[column] * 100}%`);
    });
  });

  it("leaves no pixel width and no Tailwind width class on any column", () => {
    for (const col of draw(withUnits()).match(/<col\b[^>]*>/g) ?? []) {
      expect(col).not.toMatch(/\dpx/);
      expect(col).not.toMatch(/class="[^"]*\bw-/);
    }
  });

  /**
   * Every internal boundary except `own`'s: that column is 24px, narrower than the grip's own hit
   * area, so a handle there sits on the group-own-units toggle and swallows its clicks.
   */
  it("mounts a resize handle at every internal boundary a column is wide enough for", () => {
    const markup = draw(withUnits());

    for (let index = 1; index < UNIT_COLUMNS.length - 1; index += 1) {
      expect(markup).toContain(
        `data-testid="column-splitter-${UNIT_COLUMNS[index]}-${UNIT_COLUMNS[index + 1]}"`
      );
    }
    expect(markup).not.toContain('data-testid="column-splitter-own-');
    expect((markup.match(/data-testid="column-splitter-/g) ?? []).length).toBe(
      UNIT_COLUMNS.length - 2
    );
  });
});

describe("the long order column", () => {
  const twoUnits = () =>
    hex({
      region: region({
        units: [
          unit({ unitId: "1", own: true }),
          unit({ unitId: "2", own: false, factionId: "9", factionName: "Them" })
        ]
      }),
      ownUnitCount: 1,
      foreignUnitCount: 1
    });

  const drawWith = (getLongOrder: (unitId: string) => string | null): string =>
    renderToStaticMarkup(<UnitTableDock hex={twoUnits()} preview={null} getLongOrder={getLongOrder} />);


  const rowOf = (markup: string, unitId: string): string =>
    new RegExp(`<tr[^>]*data-testid="unit-row-${unitId}"[\\s\\S]*?</tr>`).exec(markup)?.[0] ?? "";

  it("shows an own unit's month-long order, and nothing for anybody else's", () => {
    const markup = drawWith((unitId) => (unitId === "1" ? "@produce yew" : "work"));

    expect(markup).toContain("Long order");
    expect(rowOf(markup, "1")).toContain("@produce yew");
    // The foreign unit's cell is empty even when something answers for it: there is nothing of
    // anybody else's orders to read.
    expect(rowOf(markup, "2")).not.toContain("work");
  });

  it("an own unit given nothing to do this month is marked in red", () => {
    const markup = drawWith(() => null);
    const own = rowOf(markup, "1");
    const foreign = rowOf(markup, "2");

    expect(own).toContain("text-danger\">—");
    // A foreign unit's cell is blank rather than dashed - it is not a unit doing nothing.
    expect(foreign).not.toContain("text-danger\">—");
  });
});

describe("column order (ah-1owr.3)", () => {
  const withUnits = () =>
    hex({
      region: region({ units: [unit({ unitId: "1", own: true })] }),
      ownUnitCount: 1,
      foreignUnitCount: 0
    });

  afterEach(() => {
    restoreStoresForTest();
    resetWorkspaceStore();
  });

  const swapped = () => {
    const order = [...UNIT_COLUMNS] as UnitColumn[];
    // name and faction trade places, so header, colgroup and cells must all follow.
    [order[2], order[3]] = [order[3], order[2]];
    return order;
  };

  it("draws its header, its columns and its cells from one order", () => {
    const markup = draw(withUnits());
    const grips = [...markup.matchAll(/data-testid="column-reorder-(\w+)"/g)].map(
      (match) => match[1]
    );

    expect(grips).toEqual(UNIT_COLUMNS.filter((column) => column !== "own"));
    expect((markup.match(/<col\b/g) ?? []).length).toBe(UNIT_COLUMNS.length);

    const row = /<tr[^>]*data-testid="unit-row-1"[\s\S]*?<\/tr>/.exec(markup)?.[0] ?? "";
    expect((row.match(/<td\b/g) ?? []).length).toBe(UNIT_COLUMNS.length);
  });

  it("draws header, columns and rows in the stored order", () => {
    // A static render reads the store's `getInitialState()`, not its live state, so the preference
    // has to be mirrored onto it - which is all `renderWithStoreState` does.
    const markup = renderWithStoreState(
      <UnitTableDock hex={withUnits()} preview={null} />,
      useWorkspaceStore,
      { unitColumnOrder: swapped() }
    );

    const grips = [...markup.matchAll(/data-testid="column-reorder-(\w+)"/g)].map(
      (match) => match[1]
    );
    expect(grips).toEqual(swapped().filter((column) => column !== "own"));

    const cols = markup.match(/<col\b[^>]*>/g) ?? [];
    cols.forEach((col, index) => {
      expect(col).toContain(`width:${DEFAULT_COLUMN_SHARES[swapped()[index]] * 100}%`);
    });

    // The rows follow the header rather than keeping a sequence of their own.
    const row = /<tr[^>]*data-testid="unit-row-1"[\s\S]*?<\/tr>/.exec(markup)?.[0] ?? "";
    expect((row.match(/<td\b/g) ?? []).length).toBe(UNIT_COLUMNS.length);
  });

  it("falls back to the shipped order when the stored one does not fit this build", () => {
    // Not a permutation of this build's columns - the store's own `merge` rejects such a value on
    // load, and a render must not try to draw one either.
    const markup = renderWithStoreState(
      <UnitTableDock hex={withUnits()} preview={null} />,
      useWorkspaceStore,
      { unitColumnOrder: ["own", "name"] as UnitColumn[] }
    );
    const grips = [...markup.matchAll(/data-testid="column-reorder-(\w+)"/g)].map(
      (match) => match[1]
    );

    expect(grips).toEqual(UNIT_COLUMNS.filter((column) => column !== "own"));
  });

  it("mounts a reorder grip on every column but the marker", () => {
    const markup = draw(withUnits());

    expect(markup).not.toContain('data-testid="column-reorder-own"');
    expect((markup.match(/data-testid="column-reorder-/g) ?? []).length).toBe(
      UNIT_COLUMNS.length - 1
    );
  });

  it("names each grip after the column it moves, as a reader hears it", () => {
    expect(draw(withUnits())).toContain('aria-label="Move the Long order column"');
  });

  it("has an overlay for the drag feedback, outside the table and taking no pointer events", () => {
    const markup = draw(withUnits());
    const overlay = /<div[^>]*data-testid="column-drag-overlay"[^>]*>/.exec(markup)?.[0] ?? "";

    expect(overlay).not.toBe("");
    // Without this the drop line eats the `pointerup` that ends the drag.
    expect(overlay).toContain("pointer-events-none");
    // Never inside the header: a positioned element in a `table-fixed` thead is at the mercy of
    // table layout, and the row height must not move.
    expect(markup.indexOf('data-testid="column-drag-overlay"')).toBeLessThan(
      markup.indexOf("<thead")
    );
  });
});

describe("a foreign faction's name in the faction column (ah-bu2c)", () => {
  it("renders it through renderFactionName, so the dossier can hang off the name clicked", () => {
    const markup = renderToStaticMarkup(
      <UnitTableDock
        hex={hex({ region: region({ units: [unit({ factionId: "2", factionName: "Creatures", own: false })] }) })}
        preview={null}
        renderFactionName={(factionId, label) => (
          <button type="button" data-testid={`open-dossier-${factionId}`}>
            {label}
          </button>
        )}
      />
    );

    expect(markup).toContain('data-testid="open-dossier-2"');
    expect(markup).toContain("Creatures (2)");
  });

  it("prints the plain name when nothing offers a dossier, and a dash for a concealed faction", () => {
    const plain = draw(
      hex({ region: region({ units: [unit({ factionId: "2", factionName: "Creatures", own: false })] }) })
    );
    expect(plain).toContain("Creatures (2)");
    expect(plain).not.toContain("open-dossier");

    const concealed = renderToStaticMarkup(
      <UnitTableDock
        hex={hex({ region: region({ units: [unit({ factionId: null, factionName: null, own: false })] }) })}
        preview={null}
        renderFactionName={(factionId, label) => (
          <button type="button" data-testid={`open-dossier-${factionId}`}>
            {label}
          </button>
        )}
      />
    );
    // A concealed unit belongs to no faction, so there is nothing to open a dossier for.
    expect(concealed).not.toContain("open-dossier");
    expect(concealed).toContain("—");
  });
});

describe("our own faction's name in the faction column (ah-bu2c)", () => {
  it("is printed plainly, because a dossier is for the factions we cannot see inside", () => {
    // It also keeps a row of our own to one button: the smoke suite selects a unit with
    // `row.getByRole("button")`, and a second button in the row makes that ambiguous.
    const markup = renderToStaticMarkup(
      <UnitTableDock
        hex={hex({ region: region({ units: [unit({ factionId: "95", factionName: "Borg TNG", own: true })] }) })}
        preview={null}
        renderFactionName={(factionId, label) => (
          <button type="button" data-testid={`open-dossier-${factionId}`}>
            {label}
          </button>
        )}
      />
    );

    expect(markup).toContain("Borg TNG (95)");
    expect(markup).not.toContain("open-dossier");
  });
});

describe("a skill's study points in the units-in-hex list (ah-ded4)", () => {
  it("renders TAG level (points), the notation the report itself uses", () => {
    const markup = draw(
      hex({
        region: region({
          units: [unit({ skills: [{ name: "mining", tag: "MINI", level: 2, points: 90 }] })]
        })
      })
    );

    expect(markup).toContain("MINI 2 (90)");
  });

  it("tells apart two units at the same level a month apart in study", () => {
    const markup = draw(
      hex({
        region: region({
          units: [
            unit({ unitId: "1", name: "Early", skills: [{ name: "mining", tag: "MINI", level: 2, points: 90 }] }),
            unit({ unitId: "2", name: "Later", skills: [{ name: "mining", tag: "MINI", level: 2, points: 150 }] })
          ]
        })
      })
    );

    expect(markup).toContain("MINI 2 (90)");
    expect(markup).toContain("MINI 2 (150)");
  });

  it("renders (0) for a skill with no points yet, because zero is a real value", () => {
    const markup = draw(
      hex({
        region: region({
          units: [unit({ skills: [{ name: "mining", tag: "MINI", level: 0, points: 0 }] })]
        })
      })
    );

    expect(markup).toContain("MINI 0 (0)");
  });

  it("says nothing odd for a unit with no skills at all", () => {
    const markup = draw(hex({ region: region({ units: [unit({ skills: [] })] }) }));

    expect(markup).not.toContain("(undefined)");
    expect(markup).not.toContain("NaN");
  });
});

/**
 * The Silver column (`ah-1wcw.1`).
 *
 * Markup only, which is the whole of what this package can see: the column's states table in the
 * bead's plan is the contract, and each row of it is a test here.
 */
describe("the Silver column", () => {
  // `1:6,52` is this file's existing fixture region; `aUnitSilver` defaults to the builders'
  // own world.
  const forecast = (overrides: Partial<UnitSilver> = {}): UnitSilver =>
    aUnitSilver({ regionId: "1:6,52", ...overrides });

  function drawSilver(
    silver: UnitSilver | null,
    warned: string[] = []
  ): string {
    const only = unit({ unitId: "1", own: true });
    return renderToStaticMarkup(
      <UnitTableDock
        hex={hex({ region: region({ units: [only] }), ownUnitCount: 1 })}
        getSilver={() => silver}
        // Warned unit ids, keyed exactly as `unitsWarnedAboutSilver` keys them - by this fixture's
        // one hex and the id (`silverKey`, `ah-jw85`).
        silverWarnings={new Set(warned.map((unitId) => silverKey("1:6,52", unitId)))}
        onSelectUnit={() => {}}
      />
    );
  }

  it("a_unit_in_credit_shows_its_figure_in_default_ink", () => {
    const markup = drawSilver(forecast({ atMonthEnd: 800 }));
    expect(markup).toContain(">800<");
    expect(markup).not.toContain("text-danger\">800");
  });

  // A withdrawal is paid by the faction's fund, so the figure the core hands over is the unit's
  // silver undiminished. That the core no longer reduces it is pinned in Rust; what this pins is
  // that `withdrawing` paints nothing here - the flag is the hover's business, not the column's
  // (`ah-tdsi`).
  it("a_withdrawing_unit_shows_its_silver_in_default_ink", () => {
    const markup = drawSilver(forecast({ held: 369, atMonthEnd: 369, withdrawing: true }));
    expect(markup).toContain(">369<");
    expect(markup).not.toContain('text-danger">369');
  });

  it("a_unit_that_runs_out_shows_a_red_figure", () => {
    const markup = drawSilver(forecast({ atMonthEnd: -140 }));
    expect(markup).toContain("-140");
    expect(markup).toContain("text-danger");
  });

  it("a_unit_that_runs_out_shows_a_red_warned_figure", () => {
    const markup = drawSilver(forecast({ atMonthEnd: -140 }), ["1"]);
    expect(markup).toContain("unit-silver-1");
    expect(markup).toContain("⚠");
    expect(markup).toContain("-140");
  });

  it("a_unit_that_cannot_pay_for_its_orders_reads_red", () => {
    const markup = drawSilver(
      forecast({
        income: 120,
        lateIncome: 120,
        expense: 60,
        atMonthEnd: 60,
        shortForOrders: 60
      })
    );
    expect(markup).toContain("text-right tabular-nums text-danger");
    expect(markup).toContain(">60<");
  });

  it("a_zero_that_cannot_pay_its_orders_is_red_not_dim", () => {
    const markup = drawSilver(
      forecast({
        income: 60,
        lateIncome: 60,
        expense: 60,
        atMonthEnd: 0,
        shortForOrders: 60
      })
    );
    expect(markup).toContain("text-right tabular-nums text-danger");
    expect(markup).not.toContain('<span class="text-ink-dim">0</span>');
  });

  it("a_warned_unit_in_credit_still_shows_the_warning", () => {
    const markup = drawSilver(forecast({ atMonthEnd: 44 }), ["1"]);
    expect(markup).toContain("unit-silver-1");
    expect(markup).toContain("⚠");
    expect(markup).toContain("44");
  });

  it("a_month_that_cannot_be_priced_shows_a_question_mark", () => {
    const markup = drawSilver(
      forecast({ income: null, atMonthEnd: null, doubt: "unknown-tax-base" })
    );
    expect(markup).toContain("?");
    expect(markup).not.toContain("unit-silver-1");
  });

  it("a_unit_with_no_forecast_shows_nothing", () => {
    const markup = drawSilver(null);
    expect(markup).not.toContain("unit-silver-1");
    expect(markup).not.toContain("⚠");
  });

  it("only_a_warned_cell_is_a_button", () => {
    expect(drawSilver(forecast({ atMonthEnd: -140 }))).not.toContain("unit-silver-1");
    expect(drawSilver(forecast({ atMonthEnd: -140 }), ["1"])).toContain("unit-silver-1");
  });

  // `ah-jw85`: `new-1` is unique to a hex, not to a turn - two hexes can each hold a unit a
  // `FORM 1` created this month, and each must show its own figure rather than one hex's borrowed
  // from the other.
  it("two_hexes_forming_the_same_alias_get_their_own_figures", () => {
    const formedIn = (regionId: string, atMonthEnd: number) => {
      const forming = aReportUnit({ unitId: "new-1", name: "Unit (new 1)", regionId, own: true });
      const bySilverKey = new Map([
        [silverKey(regionId, "new-1"), aUnitSilver({ unitId: "new-1", regionId, atMonthEnd })]
      ]);
      return renderToStaticMarkup(
        <UnitTableDock
          hex={hex({
            regionId,
            region: region({ regionId, units: [forming] }),
            ownUnitCount: 1
          })}
          getSilver={(unitId, hexId) => bySilverKey.get(silverKey(hexId, unitId)) ?? null}
        />
      );
    };

    const first = formedIn("1:6,52", 300);
    const second = formedIn("1:8,53", -25);

    expect(first).toContain(">300<");
    expect(first).not.toContain(">-25<");
    expect(second).toContain(">-25<");
    expect(second).not.toContain(">300<");
  });

  // Decision D1 (`ah-ty3s.1`, reversing `ah-jw85`'s C1 and I2): a formed row's Id cell and its ⚠
  // both name and select the row's own unit, so the mouse agrees with the keyboard, which has
  // always selected `new-1`. `packages/shared` has no jsdom (`ah-nass`), so what is checkable here
  // is the markup a click would act on - the `aria-label`s both controls carry - not the click.
  it("a_formed_rows_id_cell_is_labelled_for_the_formed_unit_not_for_its_creator", () => {
    const forming = aReportUnit({ unitId: "new-1", name: "Unit (new 1)", regionId: "1:6,52", own: true });
    const silver = aUnitSilver({
      unitId: "new-1",
      regionId: "1:6,52",
      atMonthEnd: -50,
      formed: { alias: "1", formedBy: "1922" }
    });
    const markup = renderToStaticMarkup(
      <UnitTableDock
        hex={hex({ region: region({ units: [forming] }), ownUnitCount: 1 })}
        getSilver={() => silver}
        silverWarnings={new Set([silverKey("1:6,52", "new-1")])}
        onSelectUnit={() => {}}
      />
    );

    // The Id cell's own aria-label, and - separately, or the assertion above would carry it - the
    // ⚠ button's sr-only text. Both the row's own id, and neither the unit that forms it.
    expect(markup).toContain('aria-label="unit new-1"');
    expect(markup).toContain('<span class="sr-only">unit new-1 </span>');
    expect(markup).not.toContain("unit 1922");
  });

  // `ah-ofpb.1`. The ITEMS hover reads the same cap sentence the SILVER hover already gives, from
  // the row's own forecast - not from any preview field - so it explains a row the orders changed
  // nothing on: a unit whose PRODUCE was capped all the way to nothing.
  it("explains a capped production on a row the orders changed nothing on", () => {
    const markup = drawSilver(
      forecast({
        produced: 5,
        producedName: "sword",
        productionWanted: 8,
        productionCappedBy: "materials"
      })
    );

    expect(markup).toContain("not the 8 its skill and tools could make");
  });
});

describe("the items column", () => {
  // `ah-agbm`. One row, one unit, so a `data-predicted`/`italic` check has nothing else in the
  // markup it could be matching by accident.
  const previewOf = (
    unitOverrides: Partial<ReportUnit>,
    previewOverrides: Partial<RegionPreview["units"][number]>
  ): RegionPreview => ({
    regionId: "1:6,52",
    units: [
      {
        unit: unit(unitOverrides),
        status: "present",
        changes: [],
        arrivingFrom: null,
        departingTo: null,
        aboard: null,
        uncounted: [],
        takenUnshown: [],
        produced: [],
        built: [],
        created: [],
        transportSent: [],
        transportReceived: [],
        transportTargetIssues: [],
        ...previewOverrides
      }
    ]
  });

  it("shows a projected item list in italic", () => {
    const markup = draw(
      hex({ region: region({ units: [unit({ unitId: "1", items: [{ amount: 5, name: "grain", tag: "GRAI" }] })] }) }),
      previewOf(
        { unitId: "1", items: [{ amount: 5, name: "grain", tag: "GRAI" }] },
        { changes: [{ field: "items", original: "0 GRAI" }] }
      )
    );

    expect(markup).toContain('data-predicted="true"');
    expect(markup).toContain("italic text-brass");
    expect(markup).toContain("5 GRAI");
  });

  it("marks a cell whose month could not be fully counted, upright when nothing was projected", () => {
    const markup = draw(
      hex({ region: region({ units: [unit({ unitId: "1", items: [{ amount: 3, name: "swords", tag: "SWOR" }] })] }) }),
      previewOf(
        { unitId: "1", items: [{ amount: 3, name: "swords", tag: "SWOR" }] },
        { uncounted: ["buy all HORS"] }
      )
    );

    expect(markup).toContain(" + ?");
    expect(markup).toContain("3 SWOR");
    // The S1 state: the mark alone keeps the row distinguishable from a unit given no orders -
    // nothing was projected, so italic (which means "this figure is a projection") must not
    // appear anywhere in this row's markup.
    expect(markup).not.toContain("italic text-brass");
    expect(markup).not.toContain('data-predicted="true"');
  });

  it("shows produced goods in the projected item list", () => {
    const markup = draw(
      hex({ region: region({ units: [unit({ unitId: "1", items: [{ amount: 12, name: "iron", tag: "IRON" }] })] }) }),
      previewOf(
        {
          unitId: "1",
          items: [
            { amount: 12, name: "iron", tag: "IRON" },
            { amount: 8, name: "sword", tag: "SWOR" }
          ]
        },
        {
          changes: [{ field: "items", original: "20 IRON" }],
          produced: [{ amount: 8, tag: "SWOR" }]
        }
      )
    );

    expect(markup).toContain('data-predicted="true"');
    expect(markup).toContain("italic text-brass");
    expect(markup).toContain("8 SWOR");
  });

  // `ah-ofpb.2`.
  it("shows a builder's material draining in the projected item list", () => {
    const markup = draw(
      hex({ region: region({ units: [unit({ unitId: "1", items: [{ amount: 120, name: "wood", tag: "WOOD" }] })] }) }),
      previewOf(
        { unitId: "1", items: [{ amount: 90, name: "wood", tag: "WOOD" }] },
        {
          changes: [{ field: "items", original: "120 WOOD" }],
          built: [
            {
              amount: 30,
              tag: "WOOD",
              name: "wood",
              place: "Building 4",
              founding: false,
              helping: null,
              couldDo: 30,
              cappedBy: null
            }
          ]
        }
      )
    );

    expect(markup).toContain('data-predicted="true"');
    expect(markup).toContain("italic text-brass");
    expect(markup).toContain("90 WOOD");
  });

  it("marks a build it could not count", () => {
    const markup = draw(
      hex({ region: region({ units: [unit({ unitId: "1", items: [{ amount: 3, name: "swords", tag: "SWOR" }] })] }) }),
      previewOf(
        { unitId: "1", items: [{ amount: 3, name: "swords", tag: "SWOR" }] },
        { uncounted: ["BUILD Mine"] }
      )
    );

    expect(markup).toContain(" + ?");
    expect(markup).not.toContain("italic text-brass");
    expect(markup).not.toContain('data-predicted="true"');
  });

  // `ah-64wm`. A transport aimed at a target the report cannot settle leaves the month partly
  // uncounted, so the cell says so - and, since nothing moved, says it upright.
  it("marks a cell whose transport target the report cannot settle", () => {
    const markup = draw(
      hex({ region: region({ units: [unit({ unitId: "1", items: [{ amount: 40, name: "stone", tag: "STON" }] })] }) }),
      previewOf(
        { unitId: "1", items: [{ amount: 40, name: "stone", tag: "STON" }] },
        {
          transportTargetIssues: [
            { to: "99999", amount: 5, tag: "STON", reason: "eligibilityUnknown", orderIndex: 0 }
          ]
        }
      )
    );

    expect(markup).toContain(" + ?");
    expect(markup).toContain("40 STON");
    expect(markup).toContain(
      "does not show whether it is an eligible transport target"
    );
    expect(markup).not.toContain("italic text-brass");
    expect(markup).not.toContain('data-predicted="true"');
  });

  // A refusal the report can prove is certain: the hover explains it, and the cell stays clean.
  it("leaves a cell unmarked when the target refusal is certain", () => {
    const markup = draw(
      hex({ region: region({ units: [unit({ unitId: "1", items: [{ amount: 40, name: "stone", tag: "STON" }] })] }) }),
      previewOf(
        { unitId: "1", items: [{ amount: 40, name: "stone", tag: "STON" }] },
        {
          transportTargetIssues: [
            { to: "7001", amount: 5, tag: "STON", reason: "notQuartermaster", orderIndex: 0 }
          ]
        }
      )
    );

    expect(markup).not.toContain(" + ?");
    expect(markup).toContain("Unit 7001 is not a quartermaster, so 5 STON stay with this unit.");
  });

  // `ah-ofpb.5`. A cast's creation is a projection like any other PREDICTED figure, and a range
  // gets no ` + ?` mark - `unit.uncounted` alone still drives that span.
  it("shows a cast creation in the projected item list", () => {
    const markup = draw(
      hex({ region: region({ units: [unit({ unitId: "1", items: [{ amount: 3, name: "runesword", tag: "RUNE" }] })] }) }),
      previewOf(
        {
          unitId: "1",
          items: [{ amount: 3, name: "runesword", tag: "RUNE" }]
        },
        {
          changes: [{ field: "items", original: "0 RUNE" }],
          created: [{ fewest: 2, most: 3, tag: "RUNE", summoned: false }]
        }
      )
    );

    expect(markup).toContain('data-predicted="true"');
    expect(markup).toContain("italic text-brass");
    expect(markup).toContain("2-3 RUNE");
    expect(markup).not.toContain(" + ?");
  });
});

describe("the skills column when a GIVE of men merges it (ah-z73s.1)", () => {
  const previewOf = (
    unitOverrides: Partial<ReportUnit>,
    previewOverrides: Partial<RegionPreview["units"][number]>
  ): RegionPreview => ({
    regionId: "1:6,52",
    units: [
      {
        unit: unit(unitOverrides),
        status: "present",
        changes: [],
        arrivingFrom: null,
        departingTo: null,
        aboard: null,
        uncounted: [],
        takenUnshown: [],
        produced: [],
        built: [],
        created: [],
        transportSent: [],
        transportReceived: [],
        transportTargetIssues: [],
        ...previewOverrides
      }
    ]
  });

  it("marks the cell predicted and names what the report said when skills changed", () => {
    const markup = draw(
      hex({
        region: region({
          units: [unit({ unitId: "1", skills: [{ name: "lumberjack", tag: "LUMB", level: 2, points: 80 }] })]
        })
      }),
      previewOf(
        { unitId: "1", skills: [{ name: "lumberjack", tag: "LUMB", level: 2, points: 80 }] },
        { changes: [{ field: "skills", original: "LUMB 1 (30)" }] }
      )
    );

    expect(markup).toContain('data-predicted="true"');
    expect(markup).toContain("italic text-brass");
    expect(markup).toContain("LUMB 2 (80)");
    expect(markup).toContain("was: LUMB 1 (30)");
  });

  it("leaves the cell unmarked when a GIVE moved men but skills did not change", () => {
    // The giver's own row: a GIVE of men changes its Men and Items cells (asserted elsewhere) but
    // never its Skills cell, so the preview names no "skills" change here.
    const markup = draw(
      hex({
        region: region({
          units: [unit({ unitId: "1", skills: [{ name: "lumberjack", tag: "LUMB", level: 5, points: 450 }] })]
        })
      }),
      previewOf(
        { unitId: "1", skills: [{ name: "lumberjack", tag: "LUMB", level: 5, points: 450 }] },
        { changes: [{ field: "men", original: "10" }] }
      )
    );

    const skillsCell = /<td[^>]*>LUMB 5 \(450\)<\/td>/.exec(markup)?.[0];
    expect(skillsCell).toBeTruthy();
    expect(skillsCell).not.toContain("italic");
    expect(skillsCell).not.toContain("data-predicted");
  });
});

describe("the source rail and an Army as the source (ah-1mpx.2)", () => {
  afterEach(restoreStoresForTest);

  const armyRecord = (overrides: Partial<ArmyRecord> = {}): ArmyRecord => ({
    id: "army-1",
    gameId: "aug-2026",
    name: "Northern Host",
    members: [],
    createdAt: "2026-08-01T09:00:00Z",
    updatedAt: "2026-08-01T09:00:00Z",
    ...overrides
  });

  const aMember = (unitId: string, overrides: Partial<ArmyMemberRecord> = {}): ArmyMemberRecord => ({
    unitId,
    name: `Unit ${unitId}`,
    factionId: "1",
    factionName: "My Faction",
    own: true,
    regionId: "1:6,52",
    flags: [],
    items: [],
    skills: [],
    combatSpell: null,
    men: 3,
    seenTurn: 71,
    seenAt: "2026-08-01T09:00:00Z",
    ...overrides
  });

  const withUnits = () =>
    hex({ region: region({ units: [unit({ unitId: "1", own: true })] }), ownUnitCount: 1 });

  it("draws the rail beside the table", () => {
    const markup = draw(withUnits());

    expect(markup).toContain('data-testid="unit-source-rail"');
    expect(markup).toContain("This hex");
    expect(markup).toContain("All my units");
  });

  it("draws no Hex, Seen or Remove column for This hex", () => {
    const markup = draw(withUnits());

    expect((markup.match(/<th\b/g) ?? []).length).toBe(UNIT_COLUMNS.length);
    expect((markup.match(/<col\b/g) ?? []).length).toBe(UNIT_COLUMNS.length);
    expect(markup).not.toContain(">Seen<");
    expect(markup).not.toContain(">Hex<");
  });

  it("shows no Armies group until a game is open", () => {
    const markup = renderWithStoreState(
      <UnitTableDock hex={withUnits()} />,
      useArmiesStore,
      { gameId: "aug-2026", status: "ready", armies: [armyRecord()] }
    );

    // `client` and `game` are absent, so there is nothing to save into and nothing to offer.
    expect(markup).not.toContain("+ New Army");
    expect(markup).not.toContain("Northern Host");
  });

  it("gives every row one cell per drawn column, extra columns included", () => {
    const members = [aMember("1"), aMember("7", { name: "Outriders", regionId: "1:9,55", seenTurn: 68 })];
    const markup = renderWithStoreState(
      <UnitTableDock
        hex={withUnits()}
        ownUnits={[unit({ unitId: "1", own: true })]}
        unitsById={new Map([["1", unit({ unitId: "1", own: true })]])}
        currentTurn={71}
        client={{} as never}
        game={{ manifest: { metadata: { gameId: "aug-2026" } } } as never}
        initialSource={{ kind: "army", armyId: "army-1" }}
      />,
      useArmiesStore,
      { gameId: "aug-2026", status: "ready", armies: [armyRecord({ members })] }
    );

    const extras = 3;
    expect((markup.match(/<th\b/g) ?? []).length).toBe(UNIT_COLUMNS.length + extras);
    expect((markup.match(/<col\b/g) ?? []).length).toBe(UNIT_COLUMNS.length + extras);

    const row = /<tr[^>]*data-testid="unit-row-7"[\s\S]*?<\/tr>/.exec(markup)?.[0] ?? "";
    expect((row.match(/<td\b/g) ?? []).length).toBe(UNIT_COLUMNS.length + extras);
  });

  it("says what an Army is showing, and names its stale members", () => {
    const members = [aMember("1"), aMember("7", { seenTurn: 68 })];
    const markup = renderWithStoreState(
      <UnitTableDock
        hex={withUnits()}
        unitsById={new Map([["1", unit({ unitId: "1", own: true })]])}
        currentTurn={71}
        client={{} as never}
        game={{ manifest: { metadata: { gameId: "aug-2026" } } } as never}
        initialSource={{ kind: "army", armyId: "army-1" }}
      />,
      useArmiesStore,
      { gameId: "aug-2026", status: "ready", armies: [armyRecord({ members })] }
    );

    expect(markup).toContain("— Northern Host, 2 units");
    expect(markup).toContain("1 unit was not in this turn&#x27;s report.");
    expect(markup).toContain("Remove it");
    // The Seen column, per member.
    expect(markup).toContain("turn 68");
    expect(markup).toContain(">Rename<");
    expect(markup).toContain(">Delete<");
  });

  it("the army strip offers an export", () => {
    const strip = (currentTurn: number | null, onExportArmy?: (armyId: string) => void) =>
      renderWithStoreState(
        <UnitTableDock
          hex={withUnits()}
          currentTurn={currentTurn}
          client={{} as never}
          game={{ manifest: { metadata: { gameId: "aug-2026" } } } as never}
          initialSource={{ kind: "army", armyId: "army-1" }}
          onExportArmy={onExportArmy}
        />,
        useArmiesStore,
        { gameId: "aug-2026", status: "ready", armies: [armyRecord({ members: [aMember("1")] })] }
      );

    const offered = strip(71, () => {});
    const tag = (markup: string) =>
      /<[^>]*data-testid="army-export"[^>]*>/.exec(markup)?.[0] ?? "";

    expect(offered).toContain(">Export…<");
    expect(offered).toContain(">Rename<");
    expect(offered).toContain(">Delete<");
    expect(tag(offered).includes(' disabled=""')).toBe(false);

    // No turn on screen means no way to tell a fresh member from a remembered one, so the button
    // is drawn and disabled rather than hidden - the dock's own policy for a control it has.
    expect(tag(strip(null, () => {})).includes(' disabled=""')).toBe(true);
    // And with no shell to open the dialog - a component test - it is inert the same way.
    expect(tag(strip(71)).includes(' disabled=""')).toBe(true);
  });

  it("an empty Army says how to fill it", () => {
    const markup = renderWithStoreState(
      <UnitTableDock
        hex={withUnits()}
        currentTurn={71}
        client={{} as never}
        game={{ manifest: { metadata: { gameId: "aug-2026" } } } as never}
        initialSource={{ kind: "army", armyId: "army-1" }}
      />,
      useArmiesStore,
      { gameId: "aug-2026", status: "ready", armies: [armyRecord()] }
    );

    expect(markup).toContain("Northern Host has no units yet.");
    // `Add to army` is a brass span inside the sentence, so the tags come out before comparing.
    expect(markup.replace(/<[^>]*>/g, "")).toContain(
      "Add units to it with Add to army, on any unit in any list."
    );
  });

  it("marks only the new unit in the cursor's own hex", () => {
    // Two hexes may each write `FORM 1`, and both formed units are called `new-1` (`rules/form`),
    // so the cursor is the pair - one row is the cursor row, not two (`ah-bubf`).
    setStoreStateForTest(useWorkspaceStore, {
      selectedUnitId: "new-1",
      selectedUnitRegionId: "1:8,53"
    });
    const markup = renderWithStoreState(
      <UnitTableDock
        hex={withUnits()}
        ownUnits={[
          unit({ unitId: "new-1", regionId: "1:6,52" }),
          unit({ unitId: "new-1", regionId: "1:8,53" })
        ]}
        currentTurn={71}
        client={{} as never}
        game={{ manifest: { metadata: { gameId: "aug-2026" } } } as never}
        initialSource={{ kind: "own" }}
      />,
      useArmiesStore,
      { gameId: "aug-2026", status: "ready", armies: [] }
    );

    // `rowFor` keys on `data-testid` alone and would match both rows, so match on the pair.
    const rows = markup.match(/<tr[^>]*data-testid="unit-row-new-1"[^>]*>/g) ?? [];
    expect(rows).toHaveLength(2);
    const selected = rows.filter((row) => row.includes('data-selected="true"'));
    expect(selected).toHaveLength(1);
    expect(selected[0]).toContain('data-region-id="1:8,53"');
  });

  it("All my units spans hexes and says so", () => {
    const markup = renderWithStoreState(
      <UnitTableDock
        hex={withUnits()}
        ownUnits={[unit({ unitId: "1" }), unit({ unitId: "2", regionId: "1:9,55" })]}
        currentTurn={71}
        client={{} as never}
        game={{ manifest: { metadata: { gameId: "aug-2026" } } } as never}
        initialSource={{ kind: "own" }}
      />,
      useArmiesStore,
      { gameId: "aug-2026", status: "ready", armies: [] }
    );

    expect(markup).toContain("— all my units, 2 units");
    // One extra column, `hex`, and neither Seen nor Remove.
    expect((markup.match(/<th\b/g) ?? []).length).toBe(UNIT_COLUMNS.length + 1);
    expect(markup).not.toContain(">Seen<");
  });

  it("says so when a source spanning hexes has no report behind it", () => {
    const markup = renderWithStoreState(
      <UnitTableDock
        hex={null}
        ownUnits={[]}
        currentTurn={null}
        client={{} as never}
        game={{ manifest: { metadata: { gameId: "aug-2026" } } } as never}
        initialSource={{ kind: "own" }}
      />,
      useArmiesStore,
      { gameId: "aug-2026", status: "ready", armies: [] }
    );

    expect(markup).toContain("No report loaded.");
  });

  it("says so when the report holds no units of the player's own", () => {
    const markup = renderWithStoreState(
      <UnitTableDock
        hex={withUnits()}
        ownUnits={[]}
        currentTurn={71}
        client={{} as never}
        game={{ manifest: { metadata: { gameId: "aug-2026" } } } as never}
        initialSource={{ kind: "own" }}
      />,
      useArmiesStore,
      { gameId: "aug-2026", status: "ready", armies: [] }
    );

    expect(markup).toContain("No units of your own in this turn&#x27;s report.");
  });
});

describe("All my units shows the coming month (ah-tguk)", () => {
  afterEach(restoreStoresForTest);

  /** One previewed unit, with every field the wire carries defaulted. */
  const previewed = (
    unitOverrides: Partial<ReportUnit>,
    overrides: Partial<RegionPreview["units"][number]> = {}
  ): RegionPreview["units"][number] => ({
    unit: unit(unitOverrides),
    status: "present",
    changes: [],
    arrivingFrom: null,
    departingTo: null,
    aboard: null,
    uncounted: [],
    takenUnshown: [],
    produced: [],
    built: [],
    created: [],
    transportSent: [],
    transportReceived: [],
    transportTargetIssues: [],
    ...overrides
  });

  /** The pane on `All my units`, as markup. `hex={null}`: this source never needed one. */
  const drawOwn = (ownUnits: ReportUnit[], ordersPreview: OrdersPreviewResponse | null): string =>
    renderWithStoreState(
      <UnitTableDock
        hex={null}
        ownUnits={ownUnits}
        ordersPreview={ordersPreview}
        currentTurn={42}
        client={{} as never}
        game={{ manifest: { metadata: { gameId: "aug-2026" } } } as never}
        initialSource={{ kind: "own" }}
      />,
      useArmiesStore,
      { gameId: "aug-2026", status: "ready", armies: [] }
    );

  /** The same rows on `This hex`, so the two sources can be compared directly. */
  const drawHex = (units: ReportUnit[], preview: RegionPreview): string =>
    renderToStaticMarkup(
      <UnitTableDock hex={hex({ region: region({ units }) })} preview={preview} />
    );

  const DEPARTING = previewed(
    { unitId: "5105", name: "MinersA", regionId: "1:6,52" },
    { status: "departing", departingTo: "1:5,51" }
  );
  const ARRIVING = previewed(
    { unitId: "5105", name: "MinersA", regionId: "1:5,51" },
    { status: "arriving", arrivingFrom: "1:6,52" }
  );

  it("renders movement as an accessible letter with prediction history", () => {
    const preview = previewed(
      { movement: { ...WALKING, status: "ride", capacityMode: "ride", ride: 70 } },
      { changes: [{ field: "movement", original: "Walking" }] }
    );
    const markup = drawOwn([unit({ movement: WALKING })], {
      regions: [{ regionId: "1:6,52", units: [preview] }]
    });
    const row = /<tr data-testid="unit-row-1"[\s\S]*?<\/tr>/.exec(markup)?.[0] ?? "";

    expect(row).toContain(">R</span>");
    expect(row).toContain('<span class="sr-only">Riding</span>');
    expect(row).toContain('title="was: Walking"');
  });

  it("marks a changed ITEMS cell in a list spanning hexes", () => {
    const markup = drawOwn(
      [unit({ unitId: "1" }), unit({ unitId: "2", regionId: "1:9,55" })],
      {
        regions: [
          {
            regionId: "1:9,55",
            units: [
              previewed(
                { unitId: "2", regionId: "1:9,55", items: [{ amount: 1, tag: "PERF", name: "perfume" }] },
                { changes: [{ field: "items", original: "" }] }
              )
            ]
          }
        ]
      }
    );

    expect(markup).toContain('data-predicted="true"');
    expect(markup).toContain("1 PERF");
    expect(markup).toContain('title="was: —"');
  });

  it("draws a moving unit once, where it stands now", () => {
    const markup = drawOwn(
      [unit({ unitId: "5105", name: "MinersA", regionId: "1:6,52" })],
      { regions: [{ regionId: "1:6,52", units: [DEPARTING] }, { regionId: "1:5,51", units: [ARRIVING] }] }
    );

    expect((markup.match(/unit-row-5105/g) ?? []).length).toBe(1);
    expect(markup).toContain("1:5,51");
    expect(markup).not.toContain("←");
  });

  it("leaves a departing row upright, unlike This hex", () => {
    const mover = unit({ unitId: "5105", name: "MinersA", regionId: "1:6,52" });
    const own = drawOwn([mover], { regions: [{ regionId: "1:6,52", units: [DEPARTING] }] });
    const inHex = drawHex([mover], { regionId: "1:6,52", units: [DEPARTING] });

    expect(own).not.toContain("opacity-60");
    expect(inHex).toContain("opacity-60");
  });

  it("lists a unit formed this month", () => {
    const markup = drawOwn(
      [unit({ unitId: "1" })],
      {
        regions: [
          {
            regionId: "1:6,52",
            units: [previewed({ unitId: "new-1", name: "Unit (new 1)" }, { status: "formed" })]
          }
        ]
      }
    );

    expect(markup).toContain("unit-row-new-1");
    expect(markup).toContain(">new<");
  });

  it("draws a row for each hex when two hexes form the same alias", () => {
    const markup = drawOwn(
      [unit({ unitId: "1", regionId: "1:6,52" })],
      {
        regions: [
          {
            regionId: "1:6,52",
            units: [
              previewed(
                { unitId: "new-1", name: "Unit (new 1)", regionId: "1:6,52" },
                { status: "formed" }
              )
            ]
          },
          {
            regionId: "1:9,55",
            units: [
              previewed(
                { unitId: "new-1", name: "Unit (new 1)", regionId: "1:9,55" },
                { status: "formed" }
              )
            ]
          }
        ]
      }
    );

    expect((markup.match(/data-testid="unit-row-new-1"/g) ?? []).length).toBe(2);
    expect(markup).toContain('data-region-id="1:6,52"');
    expect(markup).toContain('data-region-id="1:9,55"');
    // The Hex column is what tells them apart on screen.
    expect(markup).toContain("(6,52)");
    expect(markup).toContain("(9,55)");
  });

  it("picks one hex's formed unit without picking the other's", () => {
    const markup = renderWithStoreState(
      <UnitTableDock
        hex={null}
        ownUnits={[unit({ unitId: "1", regionId: "1:6,52" })]}
        ordersPreview={{
          regions: [
            {
              regionId: "1:6,52",
              units: [
                previewed(
                  { unitId: "new-1", name: "Unit (new 1)", regionId: "1:6,52" },
                  { status: "formed" }
                )
              ]
            },
            {
              regionId: "1:9,55",
              units: [
                previewed(
                  { unitId: "new-1", name: "Unit (new 1)", regionId: "1:9,55" },
                  { status: "formed" }
                )
              ]
            }
          ]
        }}
        currentTurn={42}
        client={{} as never}
        game={{ manifest: { metadata: { gameId: "aug-2026" } } } as never}
        initialSource={{ kind: "own" }}
        initialPick={{
          ids: new Set([unitRowKey("1:9,55", "new-1")]),
          anchor: unitRowKey("1:9,55", "new-1")
        }}
      />,
      useArmiesStore,
      { gameId: "aug-2026", status: "ready", armies: [] }
    );

    const pickedRows = markup.match(/<tr[^>]*data-picked="true"[^>]*>/g) ?? [];
    expect(pickedRows).toHaveLength(1);
    expect(pickedRows[0]).toContain('data-region-id="1:9,55"');
  });
});

describe("the Other factions source (ah-1mpx.5)", () => {
  afterEach(restoreStoresForTest);

  const theirs = (unitId: string, over: Partial<ReportUnit> = {}) =>
    unit({ unitId, own: false, factionId: "10", factionName: "Thane's Ring", ...over });
  const concealed = (unitId: string) =>
    unit({ unitId, own: false, factionId: null, factionName: null });

  const FOREIGN = [theirs("2"), theirs("4", { factionId: "11", factionName: "Fresh Meat" }), concealed("3")];

  const withUnits = () =>
    hex({ region: region({ units: [unit({ unitId: "1", own: true })] }), ownUnitCount: 1 });

  const drawForeign = (
    props: Partial<Parameters<typeof UnitTableDock>[0]> = {},
    foreignUnits: ReportUnit[] = FOREIGN
  ) =>
    renderWithStoreState(
      <UnitTableDock
        hex={withUnits()}
        ownUnits={[unit({ unitId: "1", own: true })]}
        foreignUnits={foreignUnits}
        currentTurn={71}
        initialSource={FOREIGN_SOURCE}
        {...props}
      />,
      useArmiesStore,
      { gameId: "aug-2026", status: "ready", armies: [] }
    );

  it("the Other factions source draws every foreign unit and no own one", () => {
    const markup = drawForeign();

    expect(markup).toContain('data-testid="unit-row-2"');
    expect(markup).toContain('data-testid="unit-row-3"');
    expect(markup).toContain('data-testid="unit-row-4"');
    expect(markup).not.toContain('data-testid="unit-row-1"');
    expect(markup).toContain("— other factions, 3 units");
    // One extra column, `hex`, exactly as All my units gets - and no Seen, no Remove.
    expect((markup.match(/<th\b/g) ?? []).length).toBe(UNIT_COLUMNS.length + 1);
    expect(markup).not.toContain(">Seen<");
  });

  it("an initialPin narrows the table to that faction and says so in the hint", () => {
    const markup = drawForeign({
      initialPin: { kind: "faction", factionId: "10", factionName: "Thane's Ring" }
    });

    expect(markup).toContain('data-testid="unit-row-2"');
    expect(markup).not.toContain('data-testid="unit-row-4"');
    expect(markup).not.toContain('data-testid="unit-row-3"');
    expect(markup).toContain("— Thane&#x27;s Ring (10), 1 of 3 units");
  });

  it("a hidden pin narrows the table to the units whose owner is concealed", () => {
    const markup = drawForeign({ initialPin: { kind: "hidden" } });

    expect(markup).toContain('data-testid="unit-row-3"');
    expect(markup).not.toContain('data-testid="unit-row-2"');
    expect(markup).toContain("— faction not shown, 1 of 3 units");
  });

  it("draws the strip naming the pinned faction, and none when nothing is pinned", () => {
    const pinned = drawForeign({
      initialPin: { kind: "faction", factionId: "10", factionName: "Thane's Ring" }
    });

    expect(pinned).toContain('data-testid="foreign-strip"');
    expect(pinned).toContain("Thane&#x27;s Ring (10)");
    expect(pinned).toContain('data-testid="foreign-unpin"');
    expect(drawForeign()).not.toContain('data-testid="foreign-strip"');
  });

  it("a pin that matches nothing offers a way back to every faction", () => {
    const markup = drawForeign({
      initialPin: { kind: "faction", factionId: "77", factionName: "Gone" }
    });

    expect(markup).toContain("Gone (77) has no units in this turn&#x27;s report.");
    expect(markup).toContain('data-testid="foreign-show-all"');
    expect(markup).toContain("Show all 3");
  });

  it("says so when the report holds no other faction's units at all", () => {
    expect(drawForeign({}, [])).toContain("No other faction&#x27;s units in this turn&#x27;s report.");
  });

  it("says so when no report is loaded", () => {
    expect(drawForeign({ hex: null, currentTurn: null }, [])).toContain("No report loaded.");
  });

  it("a foreign unit's Skills cell says its skills are not disclosed", () => {
    // `rules/reportformat`: a report discloses a foreign unit's large items and never its skills,
    // so a blank cell would be indistinguishable from a unit that genuinely has none.
    const markup = drawForeign();

    expect(markup).toContain("not disclosed");
  });

  it("an own unit with no skills keeps an empty Skills cell", () => {
    // For your own units the report prints `Skills: none.`, so blank there really does mean none.
    const markup = renderWithStoreState(
      <UnitTableDock
        hex={withUnits()}
        ownUnits={[unit({ unitId: "1", own: true })]}
        currentTurn={71}
        initialSource={{ kind: "own" }}
      />,
      useArmiesStore,
      { gameId: "aug-2026", status: "ready", armies: [] }
    );

    expect(markup).not.toContain('<span class="italic text-ink-dim">not disclosed</span>');
  });

  it("a foreign unit that discloses a skill prints it rather than the notice", () => {
    const markup = drawForeign({}, [
      theirs("2", { skills: [{ name: "combat", tag: "COMB", level: 3, points: 180 }] })
    ]);

    expect(markup).toContain("COMB 3 (180)");
    expect(markup).not.toContain('<span class="italic text-ink-dim">not disclosed</span>');
  });

  it("a foreign unit's recovered skills replace not disclosed", () => {
    // `ah-1mpx.6.3`: a unit with no report-native skills but a battle-recovered entry now draws
    // that recovered text instead of the notice - the notice is reserved for nothing recovered.
    const derived = new Map([
      ["2", [{ name: "riding", tag: "RIDI", level: 5, turn: 71, coordinate: null, terrain: null }]]
    ]);

    const markup = drawForeign({ derivedSkills: derived });
    const row2 = /<tr data-testid="unit-row-2"[\s\S]*?<\/tr>/.exec(markup)?.[0];

    expect(row2).toContain("RIDI 5 (turn 71)");
    expect(row2).not.toContain('<span class="italic text-ink-dim">not disclosed</span>');
  });

  it("a real skill still wins over recovered skills", () => {
    // A derived-skill map is fed for every unit, including one that already discloses a skill of
    // its own - the ownership/real-skills guard in `derivedSkillsFor` must still refuse it.
    const derived = new Map([
      ["2", [{ name: "riding", tag: "RIDI", level: 5, turn: 71, coordinate: null, terrain: null }]]
    ]);

    const markup = drawForeign({ derivedSkills: derived }, [
      theirs("2", { skills: [{ name: "combat", tag: "COMB", level: 3, points: 180 }] })
    ]);

    expect(markup).toContain("COMB 3 (180)");
    expect(markup).not.toContain("RIDI 5");
  });

  it("the faction cell of a concealed unit is a button only in the Other factions source", () => {
    const inForeign = drawForeign();
    const inHex = draw(
      hex({ region: region({ units: [concealed("3")] }), ownUnitCount: 0, foreignUnitCount: 1 })
    );

    expect(inForeign).toContain('data-testid="foreign-pin-hidden"');
    expect(inForeign).toContain("not shown");
    // Elsewhere the same truth is stated, and there is no list for it to narrow.
    expect(inHex).toContain("not shown");
    expect(inHex).not.toContain('data-testid="foreign-pin-hidden"');
    // The em dash it used to read is gone: it said "nothing here" where the truth is that
    // somebody owns this unit and the rules do not let you know who.
    expect(inHex).not.toContain(">—</td>");
  });
});

describe("picking several rows (ah-1mpx.4)", () => {
  const twoRows = () =>
    hex({
      region: region({ units: [unit({ unitId: "1" }), unit({ unitId: "2" }), unit({ unitId: "3" })] }),
      ownUnitCount: 3
    });

  const rowFor = (markup: string, unitId: string) =>
    new RegExp(`<tr[^>]*data-testid="unit-row-${unitId}"[\\s\\S]*?</tr>`).exec(markup)?.[0] ?? "";

  it("washes every picked row and the cursor row more strongly", () => {
    const markup = renderWithStoreState(
      <UnitTableDock
        hex={twoRows()}
        preview={null}
        initialPick={{
          ids: new Set([unitRowKey("1:6,52", "1"), unitRowKey("1:6,52", "2")]),
          anchor: unitRowKey("1:6,52", "1")
        }}
      />,
      useWorkspaceStore,
      { selectedUnitId: "1", selectedUnitRegionId: "1:6,52" }
    );

    // Round 3's numbers exactly: the cursor keeps 25%, a merely picked row takes 15%.
    expect(rowFor(markup, "1")).toContain("bg-select/25");
    expect(rowFor(markup, "2")).toContain("bg-select/15");
    expect(rowFor(markup, "3")).not.toContain("bg-select");
  });

  it("says which rows are picked, out loud and to the smoke suite", () => {
    const markup = renderWithStoreState(
      <UnitTableDock
        hex={twoRows()}
        preview={null}
        initialPick={{
          ids: new Set([unitRowKey("1:6,52", "1"), unitRowKey("1:6,52", "2")]),
          anchor: unitRowKey("1:6,52", "1")
        }}
      />,
      useWorkspaceStore,
      { selectedUnitId: "1", selectedUnitRegionId: "1:6,52" }
    );

    // In a grid `aria-selected` is the selection and focus is the cursor, so both picked rows
    // carry it while only the cursor row is in the tab order.
    expect(rowFor(markup, "2")).toContain('data-picked="true"');
    expect(rowFor(markup, "2")).toContain('aria-selected="true"');
    expect(rowFor(markup, "3")).toContain('data-picked="false"');
    expect(rowFor(markup, "3")).toContain('aria-selected="false"');
    expect(markup).toContain('aria-multiselectable="true"');
  });

  it("draws the bulk line only at two or more picked", () => {
    const one = renderWithStoreState(
      <UnitTableDock hex={twoRows()} preview={null} initialPick={{ ids: new Set([unitRowKey("1:6,52", "1")]), anchor: unitRowKey("1:6,52", "1") }} />,
      useWorkspaceStore,
      { selectedUnitId: "1", selectedUnitRegionId: "1:6,52" }
    );
    const two = renderWithStoreState(
      <UnitTableDock
        hex={twoRows()}
        preview={null}
        initialPick={{
          ids: new Set([unitRowKey("1:6,52", "1"), unitRowKey("1:6,52", "2")]),
          anchor: unitRowKey("1:6,52", "1")
        }}
      />,
      useWorkspaceStore,
      { selectedUnitId: "1", selectedUnitRegionId: "1:6,52" }
    );

    expect(one).not.toContain('data-testid="unit-bulk-line"');
    expect(two).toContain('data-testid="unit-bulk-line"');
    expect(two).toContain("2 units picked.");
  });
});

describe("hidden columns (ah-20di)", () => {
  afterEach(restoreStoresForTest);

  const withUnits = () =>
    hex({
      region: region({ units: [unit({ unitId: "1", own: true })] }),
      ownUnitCount: 1,
      foreignUnitCount: 0
    });

  it("a hidden column is absent from the header and from every row", () => {
    const markup = renderWithStoreState(
      <UnitTableDock hex={withUnits()} preview={null} />,
      useWorkspaceStore,
      { unitColumnsShown: { ...allColumnsShown(), structure: false } }
    );

    expect(markup).not.toContain(">Structure<");
    expect(markup).toContain(">Items<");
    expect((markup.match(/<col\b/g) ?? []).length).toBe(UNIT_COLUMNS.length - 1);

    const row = /<tr[^>]*data-testid="unit-row-1"[\s\S]*?<\/tr>/.exec(markup)?.[0] ?? "";
    expect((row.match(/<td\b/g) ?? []).length).toBe(UNIT_COLUMNS.length - 1);
    expect(markup).not.toContain('data-testid="column-reorder-structure"');
  });

  it("the last drawn column carries no splitter when the columns after it are hidden", () => {
    const markup = renderWithStoreState(
      <UnitTableDock hex={withUnits()} preview={null} />,
      useWorkspaceStore,
      { unitColumnsShown: { ...allColumnsShown(), silver: false } }
    );

    expect(markup).not.toContain('data-testid="column-splitter-longOrder-silver"');
    expect(markup).not.toContain('data-testid="column-splitter-silver-');
    expect(markup).toContain('data-testid="column-splitter-structure-longOrder"');
  });
});
