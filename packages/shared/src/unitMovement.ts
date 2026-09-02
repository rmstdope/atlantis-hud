import type {
  UnitMovement,
  UnitMovementMode,
  UnitMovementStatus
} from "@atlantis/core-client";

export type UnitMovementPresentation = {
  code: "O" | "W" | "R" | "F";
  label: "Overloaded" | "Walking" | "Riding" | "Flying";
  tone: "danger" | "neutral" | "brass" | "select";
  active: UnitMovementMode;
};

export function presentUnitMovement(
  movement: UnitMovement
): UnitMovementPresentation {
  const values: Record<UnitMovementStatus, UnitMovementPresentation> = {
    overloaded: {
      code: "O",
      label: "Overloaded",
      tone: "danger",
      active: movement.capacityMode
    },
    walk: {
      code: "W",
      label: "Walking",
      tone: "neutral",
      active: movement.capacityMode
    },
    ride: {
      code: "R",
      label: "Riding",
      tone: "brass",
      active: movement.capacityMode
    },
    fly: {
      code: "F",
      label: "Flying",
      tone: "select",
      active: movement.capacityMode
    }
  };
  return values[movement.status];
}
