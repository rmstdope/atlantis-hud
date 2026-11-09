import { describe, expect, it } from "vitest";
import type { ViewportStorage } from "../workspace/mapViewportStorage";
import type { AssistantChangesState } from "./assistantChanges";
import { forgetAssistantChanges, loadAssistantChanges, saveAssistantChanges } from "./assistantChangesStorage";

function memoryStorage(): ViewportStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key)
  };
}

const LIST: AssistantChangesState = {
  open: false,
  changes: [{ unitId: "100", before: "work", after: "tax" }]
};

const TURN_71 = { gameId: "g1", factionId: "3", turn: 71 };

describe("assistant changes storage", () => {
  it("brings the list back as it was left, panel closed included", () => {
    const storage = memoryStorage();
    saveAssistantChanges(TURN_71, LIST, storage);

    expect(loadAssistantChanges(TURN_71, storage)).toEqual(LIST);
  });

  it("has nothing listed for a game it has never seen", () => {
    expect(loadAssistantChanges(TURN_71, memoryStorage()).changes).toEqual([]);
  });

  it("empties for good when another turn opens", () => {
    const storage = memoryStorage();
    saveAssistantChanges(TURN_71, LIST, storage);

    expect(loadAssistantChanges({ ...TURN_71, turn: 72 }, storage).changes).toEqual([]);
    expect(loadAssistantChanges(TURN_71, storage).changes).toEqual([]);
  });

  it("keeps each faction's list apart within a game", () => {
    const storage = memoryStorage();
    saveAssistantChanges(TURN_71, LIST, storage);
    saveAssistantChanges({ ...TURN_71, factionId: "4" }, LIST, storage);

    loadAssistantChanges({ ...TURN_71, factionId: "4", turn: 72 }, storage);

    expect(loadAssistantChanges(TURN_71, storage)).toEqual(LIST);
  });

  it("stores nothing once the list is empty", () => {
    const storage = memoryStorage();
    saveAssistantChanges(TURN_71, LIST, storage);

    saveAssistantChanges(TURN_71, { open: true, changes: [] }, storage);

    expect(storage.data.size).toBe(0);
  });

  it("reads corrupt or misshapen storage as nothing listed", () => {
    const storage = memoryStorage();
    saveAssistantChanges(TURN_71, LIST, storage);
    const [key] = storage.data.keys();

    storage.setItem(key as string, "{not json");
    expect(loadAssistantChanges(TURN_71, storage).changes).toEqual([]);

    storage.setItem(key as string, JSON.stringify({ 3: { turn: 71, open: true, changes: [{ unitId: 7 }] } }));
    expect(loadAssistantChanges(TURN_71, storage).changes).toEqual([]);
  });

  it("saves over a record it cannot read", () => {
    const storage = memoryStorage();
    saveAssistantChanges(TURN_71, LIST, storage);
    const [key] = storage.data.keys();
    storage.setItem(key as string, "{not json");

    saveAssistantChanges(TURN_71, LIST, storage);

    expect(loadAssistantChanges(TURN_71, storage)).toEqual(LIST);
  });

  it("does not throw when storage is missing or blocked", () => {
    const blocked: ViewportStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      }
    };

    expect(loadAssistantChanges(TURN_71, null).changes).toEqual([]);
    expect(loadAssistantChanges(TURN_71, blocked).changes).toEqual([]);
    expect(() => saveAssistantChanges(TURN_71, LIST, blocked)).not.toThrow();
    expect(() => forgetAssistantChanges("g1", blocked)).not.toThrow();
  });

  it("forgets a game's lists", () => {
    const storage = memoryStorage();
    saveAssistantChanges(TURN_71, LIST, storage);

    forgetAssistantChanges("g1", storage);

    expect(loadAssistantChanges(TURN_71, storage).changes).toEqual([]);
  });
});
