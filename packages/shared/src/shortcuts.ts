/**
 * The global keyboard layer's single source of truth: what the chords are, how they read on each
 * platform, and where they are allowed to fire.
 *
 * A table plus two pure functions rather than scattered listeners, so the help overlay, the
 * palette's inline hints and the actual dispatch can never disagree about what a key does.
 */

export type ShortcutId =
  | "palette"
  | "help"
  | "gameData"
  | "magicTree"
  | "nextUnit"
  | "prevUnit"
  | "nextDiagnostic"
  | "prevDiagnostic";

export type ShortcutSpec = {
  id: ShortcutId;
  /** The help overlay's grouping heading. */
  group: string;
  description: string;
  /** How the chord reads on macOS keycaps. */
  mac: string;
  /** How it reads everywhere else. */
  other: string;
};

export const SHORTCUTS: readonly ShortcutSpec[] = [
  {
    id: "palette",
    group: "Navigation",
    description: "Open the command palette",
    mac: "⌘K",
    other: "Ctrl+K"
  },
  {
    id: "help",
    group: "Navigation",
    description: "Show how to get around, with the mouse and the keyboard",
    mac: "⌘/",
    other: "Ctrl+/"
  },
  {
    id: "gameData",
    group: "Navigation",
    description: "Browse the game data - skills, items, buildings and the rest",
    mac: "F2",
    other: "F2"
  },
  {
    id: "magicTree",
    group: "Navigation",
    description: "Read what each magic skill needs before it can be studied",
    mac: "F3",
    other: "F3"
  },
  {
    id: "nextUnit",
    group: "Units",
    description: "Select your next unit, anywhere on the map",
    mac: "⌥↓",
    other: "Alt+↓"
  },
  {
    id: "prevUnit",
    group: "Units",
    description: "Select your previous unit",
    mac: "⌥↑",
    other: "Alt+↑"
  },
  {
    id: "nextDiagnostic",
    group: "Problems",
    description: "Jump to the next problem in the orders",
    mac: "F8",
    other: "F8"
  },
  {
    id: "prevDiagnostic",
    group: "Problems",
    description: "Jump to the previous problem",
    mac: "⇧F8",
    other: "Shift+F8"
  }
];

type KeyChord = {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
};

/**
 * Which shortcut a keydown means, or null - which is most keys, deliberately: everything not in
 * the table above belongs to whichever widget is focused.
 *
 * `Mod` is the platform's own command modifier and only that one: Ctrl+K on a mac is not the
 * palette, exactly as ⌘K on Windows is not. Letters compare case-insensitively so caps lock
 * cannot disable a chord, but a genuinely held Shift makes it a different chord.
 */
export function matchShortcut(event: KeyChord, isMac: boolean): ShortcutId | null {
  const mod = isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  const noMod = !event.metaKey && !event.ctrlKey;

  if (mod && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "k") {
    return "palette";
  }
  // Help tolerates Shift: on some layouts / itself needs it (German: Shift+7), and on US
  // keyboards Shift turns the key into "?". Either way the player is reaching for help.
  if (mod && !event.altKey && (event.key === "/" || event.key === "?")) {
    return "help";
  }

  if (event.altKey && noMod && !event.shiftKey) {
    if (event.key === "ArrowDown") {
      return "nextUnit";
    }
    if (event.key === "ArrowUp") {
      return "prevUnit";
    }
  }

  if (event.key === "F2" && noMod && !event.altKey && !event.shiftKey) {
    return "gameData";
  }

  if (event.key === "F3" && noMod && !event.altKey && !event.shiftKey) {
    return "magicTree";
  }

  if (event.key === "F8" && noMod && !event.altKey) {
    return event.shiftKey ? "prevDiagnostic" : "nextDiagnostic";
  }

  return null;
}

/**
 * Whether a matched shortcut may fire where the keydown happened.
 *
 * The palette, the help overlay and the two reference views answer from anywhere - they are how the
 * keyboard gets around, and F2 and F3 are unmodified function keys that produce no character, so
 * neither can ever be something the player was trying to type. Looking a thing up mid-sentence while
 * writing orders is exactly when a reference view is wanted.
 * The cycling chords answer everywhere except foreign text inputs: in the snippet-body textarea
 * or the unit filter an arrow chord belongs to that input, but the orders editor is exactly where
 * walking units and problems is wanted, so it is carved back in.
 */
export function firesInContext(
  id: ShortcutId,
  target: { isTextInput: boolean; isOrdersEditor: boolean }
): boolean {
  if (id === "palette" || id === "help" || id === "gameData" || id === "magicTree") {
    return true;
  }
  return !target.isTextInput || target.isOrdersEditor;
}

/**
 * Whether this is a mac keyboard, which decides what Mod means and which spelling the help
 * shows. Guarded: the store of truth is the browser, and tests run under Node.
 */
export function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") {
    return false;
  }
  return /Mac|iPhone|iPad/.test(navigator.platform);
}
