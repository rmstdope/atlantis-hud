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
  buildings: {
    TOWER: { description: "A tower.", size: 10, cost: 10, materials: ["stone"], mages: 0, buildSkill: "BUIL", buildLevel: 1 },
    MINE: { description: "A mine.", produces: "iron", cost: 10, materials: ["wood", "stone"], mages: 0, buildSkill: "MINI", buildLevel: 3 },
    LAIR: { description: "A lair.", mages: 0 },
    SHRINE: { description: "A shrine.", mages: 0, buildSkill: "ZZZZ", buildLevel: 2 },
    HUT: { description: "A hut.", mages: 0, buildSkill: "MINI" },
    FORT: { description: "A fort.", size: 50, cost: 10, materials: ["stone"], mages: 1, buildSkill: "BUIL", buildLevel: 1 }
  }
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

  it("says what skill builds a buildable structure", () => {
    const html = markup("building:MINE");
    expect(html).toContain("Built with");
    expect(html).toContain(">mining</button> 3<");
  });

  it("offers the build skill as a link into the skills tab", () => {
    const html = markup("building:MINE");
    expect(html).toContain('data-testid="game-data-link-skill:MINI"');
  });

  it("says nothing about building a structure with no build skill", () => {
    const html = markup("building:LAIR");
    expect(html).toContain("A lair.");
    expect(html).not.toContain("Built with");
  });

  it("is silent rather than broken when the build tag matches no skill", () => {
    const html = markup("building:SHRINE");
    expect(html).toContain("A shrine.");
    expect(html).not.toContain("Built with");
    expect(html).not.toContain("ZZZZ");
  });

  it("leaves no trailing space when the build skill carries no level", () => {
    const html = markup("building:HUT");
    expect(html).toContain(">mining</button></span>");
  });

  it("says a structure that shelters mages does so", () => {
    const html = markup("building:FORT");
    expect(html).toMatch(/Mages sheltered<\/span><span class="text-ink">1<\/span>/);
  });

  it("says nothing about mages for a structure that shelters none", () => {
    const html = markup("building:TOWER");
    expect(html).toContain("A tower.");
    expect(html).not.toContain("Mages");
  });

  it("no longer claims a structure needs mages", () => {
    for (const id of ["building:FORT", "building:TOWER", "building:LAIR"]) {
      expect(markup(id)).not.toContain("Mages needed");
    }
  });

  it("names every tab with its count and offers a filter scoped to the tab", () => {
    const html = markup(null);
    expect(html).toContain("Skills");
    expect(html).toContain("Buildings");
    expect(html).toContain("Filter skills…");
    expect(html).toContain("Game data");
    expect(html).toContain("Close");
  });
  // ah-vwdi: the dialog opens at pt-[10vh], so its max height must leave a matching margin below
  // rather than running to the bottom edge of the screen. A string assertion is all a
  // renderToStaticMarkup suite can do; the real check is by hand and in the smoke suite.
  it("stops short of the bottom edge, leaving a margin matching the one above", () => {
    const html = markup(null);
    // No `!`: theme.css's 90vh cap is a `:where()` default at zero specificity (ah-y4zb), so this
    // 80vh wins on its own. Before that it did not, and the dialog ran to the bottom edge
    // (ah-vwdi, verification failure) - the cap itself is pinned by theme.test.ts.
    expect(html).toContain("max-h-[80vh]");
    expect(html).not.toContain("max-h-[80vh]!");
  });
});
