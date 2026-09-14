import { describe, expect, it } from "vitest";
import {
  BOOLEAN_SETTINGS,
  BOOLEAN_SETTING_KEYS,
  booleanSettingDefaults,
  pickBooleanSettings,
  reconcileBooleanSettings
} from "./booleanSettings";

describe("the boolean settings table", () => {
  it("defaults every boolean setting to its declared default", () => {
    expect(booleanSettingDefaults()).toEqual({
      biomeTextures: true,
      biomeTextureRotation: true,
      animateWaterTextures: true,
      showShortcutsAtStartup: true,
      movementPlanner: false,
      orderOcd: false,
      countUpkeep: true
    });
  });

  it("picks only the boolean settings out of a larger state", () => {
    const picked = pickBooleanSettings({ ...booleanSettingDefaults(), theme: "dark" } as never);

    expect(Object.keys(picked).sort()).toEqual([...BOOLEAN_SETTING_KEYS].sort());
  });

  it("keeps stored booleans and replaces anything else with the default", () => {
    expect(
      reconcileBooleanSettings({ orderOcd: true, countUpkeep: "false", movementPlanner: 1 })
    ).toEqual({ ...booleanSettingDefaults(), orderOcd: true, countUpkeep: true, movementPlanner: false });
  });

  it("names only real settings as requirements", () => {
    for (const key of BOOLEAN_SETTING_KEYS) {
      const requires = (BOOLEAN_SETTINGS[key] as { requires?: string }).requires;
      if (requires !== undefined) {
        expect(BOOLEAN_SETTING_KEYS).toContain(requires);
      }
    }
  });

  it("gives every setting its own test id", () => {
    const ids = BOOLEAN_SETTING_KEYS.map((key) => BOOLEAN_SETTINGS[key].testId);

    expect(new Set(ids).size).toBe(ids.length);
  });
});
