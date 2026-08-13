import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseItemReference, type ItemCapacity, type ItemReference } from "./data";

const DATA_HTML = readFileSync(
  fileURLToPath(new URL("../../../tests/fixtures/ruleset/neworigins-data.html", import.meta.url)),
  "utf8"
);

/**
 * Recomputes a unit's four capacities from the scraped item table.
 *
 * An item contributes to a mode only if it can carry itself in that mode, and when it does it
 * contributes its own weight as well as its capacity - a horse carries itself and 20 more. That
 * rule is not stated anywhere on the page; it was derived from the reports below and then checked
 * against all three.
 *
 * The gate is `selfMobile`, not `capacity > 0`. The page prints capacity net of the item's own
 * weight, which is why the formula adds the weight back; an item printed as bare `can walk` is one
 * whose net capacity is zero, so it still carries itself. Gating on the number instead stranded
 * livestock (weight 50) and catapults (weight 800), making any unit holding one look immobile.
 */
function capacitiesOf(items: ItemReference, contents: [string, number][]): ItemCapacity {
  const total: ItemCapacity = { walk: 0, ride: 0, fly: 0, swim: 0 };

  for (const [tag, amount] of contents) {
    const item = items[tag];
    for (const mode of ["walk", "ride", "fly", "swim"] as const) {
      if (item.selfMobile[mode]) {
        total[mode] += amount * (item.weight + item.capacity[mode]);
      }
    }
  }
  return total;
}

function weightOf(items: ItemReference, contents: [string, number][]): number {
  return contents.reduce((sum, [tag, amount]) => sum + amount * items[tag].weight, 0);
}

/**
 * The scraped item table, checked against an oracle we did not write.
 *
 * Every unit in a turn report carries `Weight:` and `Capacity: fly/ride/walk/swim` as the *server*
 * computed them. Reproducing those numbers from the scraped weights and capacities is independent
 * evidence that the catalogue was read correctly - a classification or number that came out wrong
 * would not add up to what the game printed.
 *
 * The three units below are quoted from tests/fixtures/reports/neworigins-3.0.0-g7-f95-t71.rep.
 */
describe("the item table reproduces the server's own capacity arithmetic", () => {
  const items = parseItemReference(DATA_HTML);

  it("matches Drone (13432): a hill dwarf with a horse and some silver", () => {
    // "* Drone (13432), Borg TNG (95), ... hill dwarf [HDWA], horse [HORS], 22 silver [SILV].
    //    Weight: 60. Capacity: 0/70/85/0."
    const contents: [string, number][] = [
      ["HDWA", 1],
      ["HORS", 1],
      ["SILV", 22]
    ];

    expect(weightOf(items, contents)).toBe(60);
    expect(capacitiesOf(items, contents)).toEqual({ fly: 0, ride: 70, walk: 85, swim: 0 });
  });

  it("matches Drones (14451): fifty lizardmen, who can swim", () => {
    // "* Drones (14451), ... 50 lizardmen [LIZA], 7500 silver [SILV]. Weight: 500.
    //    Capacity: 0/0/750/750."
    const contents: [string, number][] = [
      ["LIZA", 50],
      ["SILV", 7500]
    ];

    expect(weightOf(items, contents)).toBe(500);
    expect(capacitiesOf(items, contents)).toEqual({ fly: 0, ride: 0, walk: 750, swim: 750 });
  });

  /**
   * No unit in either committed report carries a bare `can walk` item together with a `Capacity:`
   * line, so the server oracle above cannot confirm this case - swapping the gate back to
   * `capacity > 0` leaves all three oracle tests green. This test therefore pins a derivation, not
   * a measurement: `can walk` is printed when net capacity is zero, so such an item carries itself
   * and nothing more. It exists so the choice cannot be undone by accident, and it is not evidence
   * that the choice is right.
   */
  it("lets an item that only carries itself still carry itself", () => {
    // "livestock [LIVE], weight 50, can walk, moves 2 hexes per month."
    const contents: [string, number][] = [["LIVE", 100]];

    expect(weightOf(items, contents)).toBe(5000);
    expect(capacitiesOf(items, contents).walk).toBe(5000);
  });

  /**
   * The interesting one: this unit's weight exceeds every one of its capacities, so the game will
   * not let it move at all. It is the fixture's own example of an overloaded unit, and the planner
   * has to refuse it rather than route it.
   */
  it("matches the overloaded glider scout, whose weight beats all four capacities", () => {
    // "... leather armor [LARM], glider [GLID]. Weight: 16. Capacity: 15/0/15/0."
    const contents: [string, number][] = [
      ["LEAD", 1],
      ["LARM", 1],
      ["GLID", 1]
    ];

    const weight = weightOf(items, contents);
    const capacity = capacitiesOf(items, contents);

    expect(weight).toBe(16);
    expect(capacity).toEqual({ fly: 15, ride: 0, walk: 15, swim: 0 });
    expect(Math.max(capacity.fly, capacity.ride, capacity.walk, capacity.swim)).toBeLessThan(weight);
  });
});
