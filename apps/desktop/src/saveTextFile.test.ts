import { describe, expect, it, vi } from "vitest";
import { desktopTextFileSaver, filterFor } from "./saveTextFile";
import type { DesktopPlugins } from "./desktopPlugins";

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

describe("desktopTextFileSaver", () => {
  it("is undefined with no plugins", () => {
    expect(desktopTextFileSaver(undefined)).toBeUndefined();
  });

  it("asks the dialog, then writes what it answered, through the given plugins", async () => {
    const save = vi.fn().mockResolvedValue("/chosen/orders-turn-71.txt");
    const writeTextFile = vi.fn().mockResolvedValue(undefined);
    const plugins: DesktopPlugins = { save, writeTextFile };

    const saver = desktopTextFileSaver(plugins);
    expect(saver).toBeDefined();
    const path = await saver!("orders-turn-71.txt", "unit 1 : work");

    expect(save).toHaveBeenCalledWith({
      defaultPath: "orders-turn-71.txt",
      filters: [{ name: "Text", extensions: ["txt"] }]
    });
    expect(writeTextFile).toHaveBeenCalledWith("/chosen/orders-turn-71.txt", "unit 1 : work");
    expect(path).toBe("/chosen/orders-turn-71.txt");
  });

  it("writes nothing when the dialog is cancelled", async () => {
    const save = vi.fn().mockResolvedValue(null);
    const writeTextFile = vi.fn().mockResolvedValue(undefined);
    const plugins: DesktopPlugins = { save, writeTextFile };

    const saver = desktopTextFileSaver(plugins);
    const path = await saver!("orders-turn-71.txt", "unit 1 : work");

    expect(path).toBeNull();
    expect(writeTextFile).not.toHaveBeenCalled();
  });
});
