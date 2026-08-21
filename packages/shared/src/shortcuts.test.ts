import { describe, expect, it } from "vitest";
import { SHORTCUTS, firesInContext, matchShortcut, type ShortcutId } from "./shortcuts";

type KeyEvent = Parameters<typeof matchShortcut>[0];

function key(overrides: Partial<KeyEvent>): KeyEvent {
  return { key: "", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...overrides };
}

describe("SHORTCUTS", () => {
  it("documents every shortcut with a description and both platform spellings", () => {
    const ids = SHORTCUTS.map((entry) => entry.id);
    expect(ids).toEqual([
      "palette",
      "help",
      "gameData",
      "nextUnit",
      "prevUnit",
      "nextDiagnostic",
      "prevDiagnostic"
    ]);
    for (const entry of SHORTCUTS) {
      expect(entry.description.length).toBeGreaterThan(0);
      expect(entry.mac.length).toBeGreaterThan(0);
      expect(entry.other.length).toBeGreaterThan(0);
      expect(entry.group.length).toBeGreaterThan(0);
    }
  });
});

describe("matchShortcut", () => {
  it("opens the palette on Mod+K, whichever modifier the platform means by Mod", () => {
    expect(matchShortcut(key({ key: "k", metaKey: true }), true)).toBe("palette");
    expect(matchShortcut(key({ key: "k", ctrlKey: true }), false)).toBe("palette");
    // The other platform's modifier is not this platform's Mod.
    expect(matchShortcut(key({ key: "k", ctrlKey: true }), true)).toBeNull();
    expect(matchShortcut(key({ key: "k", metaKey: true }), false)).toBeNull();
  });

  it("opens the help overlay on Mod+/, shift tolerated", () => {
    expect(matchShortcut(key({ key: "/", metaKey: true }), true)).toBe("help");
    expect(matchShortcut(key({ key: "/", ctrlKey: true }), false)).toBe("help");
    // On layouts where / itself needs Shift (German: Shift+7), the chord arrives with the
    // shift flag up - and on US layouts Shift turns the same key into "?". Both are the
    // player reaching for help, and neither collides with anything else.
    expect(matchShortcut(key({ key: "/", ctrlKey: true, shiftKey: true }), false)).toBe("help");
    expect(matchShortcut(key({ key: "?", metaKey: true, shiftKey: true }), true)).toBe("help");
  });

  it("cycles units on Alt+Arrows, with no other modifier in the chord", () => {
    expect(matchShortcut(key({ key: "ArrowDown", altKey: true }), true)).toBe("nextUnit");
    expect(matchShortcut(key({ key: "ArrowUp", altKey: true }), false)).toBe("prevUnit");
    expect(matchShortcut(key({ key: "ArrowDown", altKey: true, shiftKey: true }), true)).toBeNull();
    expect(matchShortcut(key({ key: "ArrowDown", altKey: true, ctrlKey: true }), false)).toBeNull();
  });

  it("walks diagnostics on F8 and Shift+F8", () => {
    expect(matchShortcut(key({ key: "F8" }), true)).toBe("nextDiagnostic");
    expect(matchShortcut(key({ key: "F8", shiftKey: true }), false)).toBe("prevDiagnostic");
    expect(matchShortcut(key({ key: "F8", altKey: true }), true)).toBeNull();
  });

  it("opens the game data on a bare F2", () => {
    expect(matchShortcut(key({ key: "F2" }), true)).toBe("gameData");
    expect(matchShortcut(key({ key: "F2" }), false)).toBe("gameData");
  });

  it("claims no modified F2 - a modified chord belongs to whatever else may want it", () => {
    expect(matchShortcut(key({ key: "F2", shiftKey: true }), true)).toBeNull();
    expect(matchShortcut(key({ key: "F2", altKey: true }), true)).toBeNull();
    expect(matchShortcut(key({ key: "F2", metaKey: true }), true)).toBeNull();
    expect(matchShortcut(key({ key: "F2", ctrlKey: true }), false)).toBeNull();
  });

  it("claims nothing else - plain keys belong to whoever is focused", () => {
    expect(matchShortcut(key({ key: "ArrowDown" }), true)).toBeNull();
    expect(matchShortcut(key({ key: "Enter" }), true)).toBeNull();
    expect(matchShortcut(key({ key: "k" }), true)).toBeNull();
    expect(matchShortcut(key({ key: "Escape" }), false)).toBeNull();
    expect(matchShortcut(key({ key: "z", metaKey: true }), true)).toBeNull();
  });

  it("tolerates caps lock, which uppercases the key without any shift in the chord", () => {
    expect(matchShortcut(key({ key: "K", metaKey: true }), true)).toBe("palette");
    // Shift genuinely held is a different chord, claimed by nobody.
    expect(matchShortcut(key({ key: "K", metaKey: true, shiftKey: true }), true)).toBeNull();
  });
});

describe("firesInContext", () => {
  const everywhere: ShortcutId[] = ["palette", "help", "gameData"];
  const editingAware: ShortcutId[] = ["nextUnit", "prevUnit", "nextDiagnostic", "prevDiagnostic"];

  it("lets the palette, help and the game data fire from any focus at all", () => {
    for (const id of everywhere) {
      expect(firesInContext(id, { isTextInput: false, isOrdersEditor: false })).toBe(true);
      expect(firesInContext(id, { isTextInput: true, isOrdersEditor: false })).toBe(true);
      expect(firesInContext(id, { isTextInput: true, isOrdersEditor: true })).toBe(true);
    }
  });

  it("lets the cycling shortcuts fire outside text inputs and inside the orders editor", () => {
    for (const id of editingAware) {
      expect(firesInContext(id, { isTextInput: false, isOrdersEditor: false })).toBe(true);
      expect(firesInContext(id, { isTextInput: true, isOrdersEditor: true })).toBe(true);
      // The snippet-body textarea, the unit filter, the palette's own input: an arrow chord
      // there belongs to that input, not to the map-wide walker.
      expect(firesInContext(id, { isTextInput: true, isOrdersEditor: false })).toBe(false);
    }
  });
});
