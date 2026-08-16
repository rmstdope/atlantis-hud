import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CONGESTED_CENTRE } from "../congestedFixture";
import { allBadges, buildHexViews, type HexView, type HexViewOptions } from "../hexView";
import { badgeHref } from "./badges";
import { fieldMarks } from "./index";

const ALL_ON: HexViewOptions = {
  showStaleness: true,
  showTextures: false,
  badges: allBadges(true)
};

function viewWith(changes: Partial<HexView>): HexView {
  const [base] = buildHexViews([CONGESTED_CENTRE], ALL_ON);
  return { ...base, ...changes };
}

function marks(views: HexView[]): string {
  return renderToStaticMarkup(
    <svg>
      <fieldMarks.MarkLayer views={views} />
    </svg>
  );
}

/** Everything absent, so a test can turn on exactly the mark it is about. */
const BARE: Partial<HexView> = {
  settlement: null,
  units: { own: 0, foreign: 0, monster: 0 },
  guard: null,
  ships: 0,
  buildings: 0,
  shafts: 0,
  lairs: 0,
  battle: false,
  gate: false
};

describe("fieldMarks identity", () => {
  it("names itself for the picker and the persisted setting", () => {
    expect(fieldMarks.id).toBe("field-marks");
    expect(fieldMarks.label).toBe("Field Marks (image icons)");
  });
});

describe("fieldMarks.MarkLayer", () => {
  it("draws nothing when a hex holds none of the marks this theme places", () => {
    const svg = marks([viewWith(BARE)]);
    expect(svg).not.toContain("<image");
  });

  it("draws the own-guard badge only when the guard is this faction's own", () => {
    const own = marks([viewWith({ ...BARE, guard: "own" })]);
    expect(own).toContain(`href="${badgeHref("guard-own")}"`);
    expect(own).not.toContain(`href="${badgeHref("guard-foreign")}"`);

    const foreign = marks([viewWith({ ...BARE, guard: "foreign" })]);
    expect(foreign).toContain(`href="${badgeHref("guard-foreign")}"`);
    expect(foreign).not.toContain(`href="${badgeHref("guard-own")}"`);
  });

  it("draws the monster badge only when a monster is actually present", () => {
    const present = marks([viewWith({ ...BARE, units: { own: 0, foreign: 3, monster: 1 } })]);
    expect(present).toContain(`href="${badgeHref("monster")}"`);

    const absent = marks([viewWith(BARE)]);
    expect(absent).not.toContain(`href="${badgeHref("monster")}"`);
  });

  it("draws the shaft and lair badges only when their counts are positive", () => {
    const withBoth = marks([viewWith({ ...BARE, shafts: 1, lairs: 2 })]);
    expect(withBoth).toContain(`href="${badgeHref("shaft")}"`);
    expect(withBoth).toContain(`href="${badgeHref("lair")}"`);

    const withNeither = marks([viewWith(BARE)]);
    expect(withNeither).not.toContain(`href="${badgeHref("shaft")}"`);
    expect(withNeither).not.toContain(`href="${badgeHref("lair")}"`);
  });

  it("draws the ship badge only when a ship is present", () => {
    expect(marks([viewWith({ ...BARE, ships: 1 })])).toContain(`href="${badgeHref("ship")}"`);
    expect(marks([viewWith(BARE)])).not.toContain(`href="${badgeHref("ship")}"`);
  });

  it("draws one house badge for a village and two for a town, none for an unnamed hex", () => {
    const village = marks([
      viewWith({ ...BARE, settlement: { name: "Cadburg", tier: "village" } })
    ]);
    expect([...village.matchAll(/data-badge="settlement-house"/g)]).toHaveLength(1);

    const town = marks([viewWith({ ...BARE, settlement: { name: "Sesale", tier: "town" } })]);
    expect([...town.matchAll(/data-badge="settlement-house"/g)]).toHaveLength(2);
  });

  it("draws the keep badge, not the house one, for a city", () => {
    const city = marks([viewWith({ ...BARE, settlement: { name: "Lonherford", tier: "city" } })]);
    expect(city).toContain(`href="${badgeHref("settlement-keep")}"`);
    expect(city).not.toContain(`href="${badgeHref("settlement-house")}"`);
  });

  it("gives each present unit group its own pre-coloured badge and count label", () => {
    const svg = marks([viewWith({ ...BARE, units: { own: 5, foreign: 3, monster: 1 } })]);
    expect(svg).toContain(`href="${badgeHref("unit-own")}"`);
    expect(svg).toContain(`href="${badgeHref("unit-foreign")}"`);
    expect(svg).toContain(`href="${badgeHref("unit-monster")}"`);
    // Foreign the report gave (3) less the monster already inside it (1): see shieldRow.
    expect(svg).toContain(">5<");
    expect(svg).toContain(">2<");
    expect(svg).toContain(">1<");
  });

  it("bands buildings into workshop badges, reusing the settlement-house file", () => {
    const svg = marks([viewWith({ ...BARE, buildings: 5 })]);
    expect([...svg.matchAll(/data-badge="settlement-house"/g)]).toHaveLength(2);
  });

  it("never draws the reserved gate or battle marks - this theme has no file for either", () => {
    const svg = marks([viewWith({ ...BARE, gate: true, battle: true })]);
    expect(svg).not.toContain("gate");
    expect(svg).not.toContain("battle");
  });
});
