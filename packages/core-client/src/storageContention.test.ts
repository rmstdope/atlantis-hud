import { describe, expect, it } from "vitest";
import { StorageHeldElsewhereError, isStorageHeldElsewhere } from "./storageContention";

describe("telling that another tab holds the storage", () => {
  it("recognises the error it throws", () => {
    expect(isStorageHeldElsewhere(new StorageHeldElsewhereError("game"))).toBe(true);
  });

  it("recognises one from a second copy of the bundle by its name", () => {
    const copy = Object.assign(new Error("x"), {
      name: "StorageHeldElsewhereError",
      scope: "games-list"
    });
    expect(isStorageHeldElsewhere(copy)).toBe(true);
  });

  it("does not mistake anything else for it", () => {
    expect(isStorageHeldElsewhere(new Error("x"))).toBe(false);
    expect(isStorageHeldElsewhere("StorageHeldElsewhereError")).toBe(false);
    expect(isStorageHeldElsewhere(null)).toBe(false);
  });

  it("says which data is held", () => {
    expect(new StorageHeldElsewhereError("game").message).toBe(
      "this game is open in another tab, which is holding its storage open"
    );
    expect(new StorageHeldElsewhereError("games-list").message).toBe(
      "Another Atlantis HUD tab is holding on to your saved games, so they can't be read here."
    );
    expect(new StorageHeldElsewhereError("games-list").scope).toBe("games-list");
  });
});
