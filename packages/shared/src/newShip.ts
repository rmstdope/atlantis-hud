import type { NewShip } from "@atlantis/core-client";

/**
 * How the Units in hex pane shows a ship a founding `BUILD <ship>` begins this month (`ah-ywyf`).
 *
 * Kept pure, apart from the components that draw it, because `packages/shared` renders its
 * component tests without effects (`.cerebro/traps.md`): every rule the Structure cell follows for
 * a new ship is here.
 */

/** Whatever carries the core's `newShip` - a previewed row, or a bare test object. */
type CarriesShip = { newShip?: NewShip | null };

/**
 * The Structure cell's month-end label: `Ship [new] · Longship` for a ship finished into a fleet
 * of its own, which the game numbers only when the month runs; otherwise the label as it stands.
 * The form is the next report's own (`CreateShip` names it `Ship [n]`), with the ship type as the
 * kind.
 */
export function monthEndStructureLabel(unit: CarriesShip, label: string | null): string | null {
  return unit.newShip?.outcome === "new-fleet" ? `Ship [new] · ${unit.newShip.name}` : label;
}

/** The Structure hover's note for a ship finished this month - the agreed words - or `null`. */
export function newShipStructureNote(unit: CarriesShip): string | null {
  switch (unit.newShip?.outcome) {
    case "new-fleet":
      return `Finished this month: a new ${unit.newShip.name}, with this unit aboard.`;
    case "joins-fleet":
      return `Finished this month: a new ${unit.newShip.name} joins this fleet.`;
    default:
      return null;
  }
}

/** Whether a new ship changes the Structure cell's month, so it reads in the coming month's italic. */
export function predictsStructure(unit: CarriesShip): boolean {
  return newShipStructureNote(unit) !== null;
}
