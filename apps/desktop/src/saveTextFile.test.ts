import { describe, expect, it } from "vitest";
import { filterFor } from "./saveTextFile";

describe("filterFor", () => {
  it("gives a .json name a JSON filter", () => {
    expect(filterFor("game-1.atlantis-hud-game.json")).toEqual([
      { name: "JSON", extensions: ["json"] }
    ]);
  });

  it("gives a .txt name the Text filter", () => {
    expect(filterFor("orders-turn-71.txt")).toEqual([{ name: "Text", extensions: ["txt"] }]);
  });

  it("gives an unknown extension no filter", () => {
    expect(filterFor("map-export.kmz")).toBeUndefined();
  });
});
