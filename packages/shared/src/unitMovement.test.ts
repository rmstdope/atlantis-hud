import { describe, expect, it } from "vitest";
import type { UnitMovement } from "@atlantis/core-client";
import { presentUnitMovement } from "./unitMovement";

const movement = (status: UnitMovement["status"]): UnitMovement => ({
  status,
  load: 60,
  fly: 0,
  ride: 70,
  walk: 85,
  capacityMode: "ride"
});

describe("presentUnitMovement", () => {
  it.each([
    ["overloaded", "O", "Overloaded", "danger"],
    ["walk", "W", "Walking", "neutral"],
    ["ride", "R", "Riding", "brass"],
    ["fly", "F", "Flying", "select"]
  ] as const)("%s maps to its fixed presentation", (status, code, label, tone) => {
    expect(presentUnitMovement(movement(status))).toEqual({
      code,
      label,
      tone,
      active: "ride"
    });
  });
});
