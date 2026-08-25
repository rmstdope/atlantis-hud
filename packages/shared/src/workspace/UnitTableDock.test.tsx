import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import type { RegionPreview, ReportRegion, ReportUnit, UnitSilver } from "@atlantis/core-client";
import { aReportRegion, aReportUnit, aUnitSilver } from "@atlantis/core-client";
import type { HexNode } from "../hexMapModel";
import { DEFAULT_COLUMN_SHARES, silverKey, UNIT_COLUMNS, type UnitColumn } from "../unitTable";
import { renderWithStoreState, restoreStoresForTest } from "../testing/storeState";
import { resetWorkspaceStore, useWorkspaceStore } from "../workspaceStore";
import { UnitTableDock } from "./UnitTableDock";

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
        takenUnshown: []
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
            takenUnshown: []
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

  // Decisions C1 and I2 (`ah-jw85`): a formed row's ⚠ and Id cell both name and select the unit
  // whose block wrote the FORM, not the row's own id - a unit that does not exist cannot be
  // selected, and its orders are typed in its parent's block anyway. `packages/shared` has no
  // jsdom (`ah-nass`), so what is checkable here is the markup a click would act on - the
  // `aria-label`s both controls carry - not the click itself.
  it("a_formed_row_names_the_unit_that_forms_it_on_both_its_id_and_its_warning", () => {
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

    // The Id cell's own aria-label - `rowTarget`, decision I2.
    expect(markup).toContain('aria-label="unit 1922"');
    // The ⚠ button's sr-only text - `rowTarget`, decision C1.
    expect(markup).toContain("unit 1922");
    expect(markup).not.toContain("unit new-1");
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
