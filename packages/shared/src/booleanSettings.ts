/**
 * Every on/off global setting, declared once.
 *
 * The store derives its state, defaults, persistence and startup reconciliation from this table,
 * and the settings dialog renders each toggle from its entry, so adding a flag is one entry here,
 * one `<SettingFlag>` placement and the code that reads it (`ah-x4yv`). A plain module on purpose:
 * it imports neither the store nor React, so both can import it.
 */

export type BooleanSettingSpec = {
  /** What the setting is before anybody chooses otherwise. */
  default: boolean;
  /** The toggle's title in the settings dialog, also its aria-label. */
  title: string;
  /** The line under the title. */
  description: string;
  /** The checkbox's data-testid; the smoke suite finds it by this. */
  testId: string;
  /** Another boolean setting this one only means anything under; the toggle is disabled while that one is off. */
  requires?: string;
};

export const BOOLEAN_SETTINGS = {
  biomeTextures: {
    default: true,
    title: "Biome textures",
    description: "Uses image tiles for known biomes.",
    testId: "settings-biome-textures"
  },
  biomeTextureRotation: {
    default: true,
    title: "Rotate biome textures",
    description: "Turns each hex's texture by a different angle.",
    testId: "settings-biome-texture-rotation",
    requires: "biomeTextures"
  },
  animateWaterTextures: {
    default: true,
    title: "Animate water textures",
    description: "Moves ocean and lake textures along their texture direction.",
    testId: "settings-animate-water-textures",
    requires: "biomeTextures"
  },
  /**
   * Whether the keyboard shortcuts overlay shows itself when the application starts.
   *
   * On by default, and the only piece of the interface that appears uninvited. It earns that: the
   * overlay is opened by a key, so the player who most needs it is exactly the one who cannot find
   * it. Turning it off is offered inside the overlay itself, next to the reason for wanting to.
   */
  showShortcutsAtStartup: {
    default: true,
    title: "Show the getting-around guide at startup",
    description: "The mouse and keyboard guide greets you when the application opens.",
    testId: "settings-shortcuts-at-startup"
  },
  /**
   * Whether the Movement pane shows at all. A feature flag rather than a preference: the planner
   * is the one piece of the workspace still finding its shape, so it starts off and stays off
   * until asked for.
   */
  movementPlanner: {
    default: false,
    title: "Movement planner",
    description: "Shows the experimental Movement pane for planning MOVE routes on the map.",
    testId: "settings-movement-planner"
  },
  /**
   * Whether the orders editor uppercases the command keywords as they are typed (Order OCD).
   *
   * Off by default: orders are case-insensitive to the engine, so this is purely a matter of how
   * the player likes their turn to read.
   */
  orderOcd: {
    default: false,
    title: "Order OCD",
    description:
      "Uppercase the command keywords as you write, indent each level of a nested FORM or TURN by one space, and end every unit's orders with a single blank line. Text inside quotes is left alone.",
    testId: "settings-order-ocd"
  },
  /**
   * Whether the Silver column charges each unit its monthly maintenance (`ah-1wcw.4`).
   *
   * On by default: upkeep is a real cost every month and a player who ignores it starves. It is a
   * setting at all because the fee is pooled regionally by the game, so a per-unit figure is
   * pessimistic and some players will prefer the column without it.
   */
  countUpkeep: {
    default: true,
    title: "Count upkeep in the Silver column",
    description:
      "Charge each unit its monthly maintenance at the rates of the world its game is played in, paid with food first where the unit is set to consume it.",
    testId: "settings-count-upkeep"
  }
} as const satisfies Record<string, BooleanSettingSpec>;

export type BooleanSettingKey = keyof typeof BOOLEAN_SETTINGS;
export type BooleanSettings = Record<BooleanSettingKey, boolean>;

/** Fails to compile when a `requires` names something that is not a boolean setting. */
const REQUIRES_NAMES_A_SETTING: Record<BooleanSettingKey, { requires?: BooleanSettingKey }> =
  BOOLEAN_SETTINGS;
void REQUIRES_NAMES_A_SETTING;

/** Every key, in table order. */
export const BOOLEAN_SETTING_KEYS = Object.keys(BOOLEAN_SETTINGS) as readonly BooleanSettingKey[];

/** `{ key: spec.default }` for every entry. */
export function booleanSettingDefaults(): BooleanSettings {
  return Object.fromEntries(
    BOOLEAN_SETTING_KEYS.map((key) => [key, BOOLEAN_SETTINGS[key].default])
  ) as BooleanSettings;
}

/** Only the boolean-setting keys of `state`, for `partialize`. */
export function pickBooleanSettings(state: BooleanSettings): BooleanSettings {
  return Object.fromEntries(BOOLEAN_SETTING_KEYS.map((key) => [key, state[key]])) as BooleanSettings;
}

/**
 * Keeps each stored value that is a real boolean and replaces anything else (a string, a number,
 * a missing key) with that setting's default. Storage is hand-editable - the same door
 * `reconcileAdvisoryChecks` guards. A stored `true` or `false` is a choice and is never replaced.
 */
export function reconcileBooleanSettings(
  stored: Partial<Record<BooleanSettingKey, unknown>>
): BooleanSettings {
  return Object.fromEntries(
    BOOLEAN_SETTING_KEYS.map((key) => {
      const value = stored[key];
      return [key, typeof value === "boolean" ? value : BOOLEAN_SETTINGS[key].default];
    })
  ) as BooleanSettings;
}
