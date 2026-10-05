import { describe, expect, it } from "vitest";
import { checkedKeys, markChecked, unmarkChecked, type MarkStorage } from "./reportCheckMarks";

function memoryStorage(): MarkStorage & { items: Map<string, string> } {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value)
  };
}

describe("the checked-report marks", () => {
  it("keeps a marked report marked for its game", () => {
    const storage = memoryStorage();

    markChecked(storage, "game-1", ["95:71"]);
    markChecked(storage, "game-1", ["95:72", "95:71"]);

    expect([...checkedKeys(storage, "game-1")].sort()).toEqual(["95:71", "95:72"]);
  });

  it("takes the mark off a report whose check never ran, leaving the others", () => {
    const storage = memoryStorage();

    markChecked(storage, "game-1", ["95:71", "95:72"]);
    unmarkChecked(storage, "game-1", ["95:72"]);

    expect([...checkedKeys(storage, "game-1")]).toEqual(["95:71"]);
  });

  it("keeps each game's marks apart", () => {
    const storage = memoryStorage();

    markChecked(storage, "game-1", ["95:71"]);

    expect(checkedKeys(storage, "game-2").size).toBe(0);
  });

  it("reads an unreadable record as no marks", () => {
    const storage = memoryStorage();
    storage.items.set("atlantis-hud-ruleset-checked-game-1", "{not json");

    expect(checkedKeys(storage, "game-1").size).toBe(0);
    markChecked(storage, "game-1", ["95:71"]);
    expect([...checkedKeys(storage, "game-1")]).toEqual(["95:71"]);
  });

  it("never throws when storage does", () => {
    const failing: MarkStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      }
    };

    expect(checkedKeys(failing, "game-1").size).toBe(0);
    expect(() => markChecked(failing, "game-1", ["95:71"])).not.toThrow();
  });

  it("is no marks and no writes without storage", () => {
    expect(checkedKeys(null, "game-1").size).toBe(0);
    expect(() => markChecked(null, "game-1", ["95:71"])).not.toThrow();
  });
});
