import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { parseGameData, type GameDataIndex } from "../gameData";
import { GameDataDialog } from "./GameDataDialog";

const RULESET = JSON.stringify({
  skills: {
    MINI: {
      tag: "MINI",
      name: "mining",
      cost: 10,
      maxLevel: 5,
      produces: [{ tag: "MITH", level: 3 }],
      requires: [],
      magic: false,
      levels: [{ level: 3, description: "Reaches mithril." }]
    }
  },
  items: {
    MITH: { tag: "MITH", name: "mithril", kind: "equipment", weight: 10, moves: 0, capacity: { walk: 0, ride: 0, fly: 0, swim: 0 }, selfMobile: { walk: false, ride: false, fly: false, swim: false }, description: "A trade resource." },
    LONG: { tag: "LONG", name: "Longship", kind: "ship", weight: 0, moves: 4, cargoCapacity: 150, sailingSkill: 4, capacity: { walk: 0, ride: 0, fly: 0, swim: 0 }, selfMobile: { walk: false, ride: false, fly: false, swim: false }, description: "A ship." },
    GALL: { tag: "GALL", name: "Galleon", kind: "ship", weight: 0, moves: 4, cargoCapacity: 400, capacity: { walk: 0, ride: 0, fly: 0, swim: 0 }, selfMobile: { walk: false, ride: false, fly: false, swim: false } }
  },
  buildings: { TOWER: { description: "A tower.", size: 10, cost: 10, materials: ["stone"], mages: 0 } }
});

const index = parseGameData(RULESET) as GameDataIndex;

function markup(initialEntryId: string | null): string {
  return renderToStaticMarkup(
    <GameDataDialog index={index} initialEntryId={initialEntryId} onDismiss={() => {}} />
  );
}

describe("GameDataDialog", () => {
  it("lists every ship on the Ships tab and details the chosen one", () => {
    const html = markup("ship:LONG");
    expect(html).toContain("Galleon");
    expect(html).toContain("Longship");
    expect(html).toContain("Cargo capacity");
    expect(html).toContain("Sailing skill needed");
    expect(html).toContain("A ship.");
    expect(html).toContain("Ships");
  });

  it("opens on the entry it was given, with that entry's tab selected", () => {
    const html = markup("ship:LONG");
    expect(html).toMatch(/aria-selected="true"[^>]*>Ships/);
    expect(html).toMatch(/data-testid="game-data-entry-ship:LONG"[^>]*aria-selected="true"/);
  });

  it("offers a skill's produced items as cross-references", () => {
    const html = markup("skill:MINI");
    expect(html).toContain("Produces");
    expect(html).toContain("at level 3");
    expect(html).toContain("data-testid=\"game-data-link-equipment:MITH\"");
    expect(html).toContain("Requires");
    expect(html).toContain("nothing — it can be studied from the start");
  });

  it("says the game data does not describe something it never scraped", () => {
    const html = renderToStaticMarkup(
      <GameDataDialog index={index} initialEntryId="building:ROAD N" onDismiss={() => {}} />
    );
    expect(html).toContain("The game data does not describe this.");
  });

  it("names every tab with its count and offers a filter scoped to the tab", () => {
    const html = markup(null);
    expect(html).toContain("Skills");
    expect(html).toContain("Buildings");
    expect(html).toContain("Filter skills…");
    expect(html).toContain("Game data");
    expect(html).toContain("Close");
  });
});
