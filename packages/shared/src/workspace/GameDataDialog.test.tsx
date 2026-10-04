import { aParsedReport, aReportRegion } from "@atlantis/core-client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { parseGameData, type GameDataIndex } from "../gameData";
import { NO_RECRUIT_SIGHTINGS, withRecruitTurn } from "../recruitSightings";
import { GameDataDialog, GameDataList } from "./GameDataDialog";
import { entriesOf } from "./gameDataDialogState";

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
    const html = markup("skill:MINI");
    expect(html).toContain("Skills");
    expect(html).toContain("Buildings");
    expect(html).toContain("Filter skills…");
    expect(html).toContain("Game data");
    expect(html).toContain('aria-label="Close game data"');
    expect(html).toContain(">×</button>");
    expect(html).toContain("border-brass/60");
    expect(html).toContain("shadow-xl");
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

describe("the All tab (ah-yu3j.2)", () => {
  it("opens cold on All, far left, counting every entry of every other tab", () => {
    const html = markup(null);
    expect(html).toMatch(/role="tablist"[^>]*><button[^>]*data-testid="game-data-tab-all"[^>]*aria-selected="true"[^>]*>All 10</);
    expect(html).toContain('placeholder="Filter everything…"');
    expect(html).toContain('aria-label="Filter everything…"');
  });

  it("shows the first entry A-Z selected and read out", () => {
    const html = markup(null);
    expect(html).toMatch(/data-testid="game-data-entry-building:FORT"[^>]*aria-selected="true"/);
    expect(html).toContain("A fort.");
  });

  it("marks each row on All with its kind word", () => {
    const html = markup(null);
    expect(html).toMatch(/data-testid="game-data-entry-ship:LONG"[^>]*>.*?Longship LONG.*?>Ship</);
    expect(html).toMatch(/data-testid="game-data-entry-skill:MINI"[^>]*>.*?mining MINI.*?>Skill</);
    expect(html).toMatch(/data-testid="game-data-entry-building:TOWER"[^>]*>.*?Tower.*?>Building</);
  });

  it("keeps a category tab's rows as they were, with no kind word", () => {
    const html = markup("ship:LONG");
    expect(html).toContain(">Longship LONG</button>");
    expect(html).not.toContain(">Ship</span>");
  });

  it("says nothing matches, quoting what was typed, when the filter empties All", () => {
    const html = renderToStaticMarkup(
      <GameDataList tab="all" entries={[]} filter=" zzz " selectedId={null} onPick={() => {}} />
    );
    expect(html).toContain("Nothing matches “zzz”.");
    expect(html).toContain("italic");
    expect(html).toMatch(/<li role="option" aria-disabled="true"[^>]*>Nothing matches/);
  });

  it("leaves the other tabs' empty list as it was", () => {
    const html = renderToStaticMarkup(
      <GameDataList tab="skill" entries={[]} filter="zzz" selectedId={null} onPick={() => {}} />
    );
    expect(html).not.toContain("Nothing matches");
  });

  it("says nothing about matching when All is simply empty", () => {
    const html = renderToStaticMarkup(
      <GameDataList tab="all" entries={entriesOf(index, "all", "")} filter="" selectedId={null} onPick={() => {}} />
    );
    expect(html).not.toContain("Nothing matches");
  });
});

/* --- terrains (ah-yu3j.1) --- */

const NO_CAPACITY = { walk: 0, ride: 0, fly: 0, swim: 0 };
const NO_MOBILITY = { walk: false, ride: false, fly: false, swim: false };
const thing = (tag: string, name: string, kind: string, description?: string) => ({
  tag, name, kind, weight: 1, moves: 0, capacity: NO_CAPACITY, selfMobile: NO_MOBILITY, description
});

const terrainIndex = parseGameData(
  JSON.stringify({
    skills: {},
    items: {
      IRON: thing("IRON", "iron", "equipment"),
      MITH: thing("MITH", "mithril", "equipment"),
      FISH: thing("FISH", "fish", "equipment"),
      SWOR: thing("SWOR", "sword", "equipment"),
      HDWA: thing("HDWA", "hill dwarves", "man"),
      ORC: thing("ORC", "orcs", "man"),
      GRIZ: thing("GRIZ", "grizzly bear", "monster", "Monster prefers to roam the mountain terrain."),
      WORM: thing("WORM", "giant worm", "monster", "Monster prefers to roam the cavern, tunnels terrains.")
    },
    terrainResources: { mountain: ["IRON", "MITH"], ocean: ["FISH"] },
    terrainResourceChances: { mountain: { IRON: 100, MITH: 35 }, ocean: { FISH: 100 } },
    movement: {
      terrainCosts: { normal: 1, premiums: { mountain: 2 }, premiumFor: ["ride", "walk"] },
      road: { divisor: 2, minimumCost: 1 },
      ocean: { requiresShipUnlessFlying: true, flyingMustEndOnLand: true, terrain: "ocean", alsoWater: [] }
    }
  })
) as GameDataIndex;

const sale = (tag: string, name: string) => ({ amount: 5, name, tag, price: 40 });
const recruits = withRecruitTurn(
  NO_RECRUIT_SIGHTINGS,
  aParsedReport({
    regions: [0, 2, 4, 6].map((x) =>
      aReportRegion({
        coordinate: { x, y: 0, z: 1 },
        terrain: "mountain",
        forSale: x === 0 ? [sale("HDWA", "hill dwarves"), sale("ORC", "orcs")] : [sale("HDWA", "hill dwarves")]
      })
    )
  }),
  terrainIndex
);

function terrainMarkup(initialEntryId: string | null, sightings = recruits): string {
  return renderToStaticMarkup(
    <GameDataDialog
      index={terrainIndex}
      initialEntryId={initialEntryId}
      recruits={sightings}
      onDismiss={() => {}}
    />
  );
}

describe("GameDataDialog's terrains (ah-yu3j.1)", () => {
  it("puts a Terrains tab with its count last in a strip that wraps", () => {
    const html = terrainMarkup(null);
    expect(html).toMatch(/game-data-tab-building"[^>]*>Buildings 0<\/button><button[^>]*game-data-tab-terrain"[^>]*>Terrains 4<\/button><\/div>/);
    expect(html).toMatch(/role="tablist"[^>]*class="[^"]*flex-wrap/);
  });

  it("lists the terrains in lower case with no tag, and scopes the filter to them", () => {
    const html = terrainMarkup("terrain:mountain");
    expect(html).toContain('placeholder="Filter terrains…"');
    expect(html).toContain('aria-label="Filter terrains"');
    for (const name of ["cavern", "mountain", "ocean", "tunnels"]) {
      expect(html).toContain(`data-testid="game-data-entry-terrain:${name}"`);
    }
    expect(html).toMatch(/game-data-entry-terrain:mountain"[^>]*>mountain<\/button>/);
  });

  it("shows a mountain's page with all six parts", () => {
    const html = terrainMarkup("terrain:mountain");
    expect(html).toMatch(/<span class="flex-1">mountain<\/span><\/h2>/);
    expect(html).toContain(">Movement cost</span><span class=\"text-ink\">2 walking or riding · 1 flying</span>");
    expect(html).toContain(">Along a road</span><span class=\"text-ink\">1</span>");
    expect(html).toContain(">Found here</h3>");
    expect(html).toMatch(/game-data-link-equipment:IRON"[^>]*>iron<\/button><span class="text-ink-dim">always<\/span>/);
    expect(html).toMatch(/game-data-link-equipment:MITH"[^>]*>mithril<\/button><span class="text-ink-dim">in 35% of regions<\/span>/);
    expect(html).toContain(">Seen for sale in your reports</h3>");
    expect(html).toMatch(/game-data-link-man:HDWA"[^>]*>hill dwarves<\/button><span class="text-ink-dim">4 mountain regions<\/span>/);
    expect(html).toMatch(/game-data-link-man:ORC"[^>]*>orcs<\/button><span class="text-ink-dim">1 mountain region<\/span>/);
    expect(html).toContain(">Monsters that roam here</h3>");
    expect(html).toMatch(/game-data-link-monster:GRIZ"[^>]*>grizzly bear<\/button>/);
  });

  it("shows the ocean's rule in words, no road, and both empty lines", () => {
    const html = terrainMarkup("terrain:ocean");
    expect(html).toContain("needs a ship — a flier may cross but must end its move on land");
    expect(html).not.toContain("Along a road");
    expect(html).toMatch(/game-data-link-equipment:FISH"[^>]*>fish<\/button>/);
    expect(html).toContain("No ocean region in your reports has had recruits for sale.");
    expect(html).toContain("No monster in the game data roams here.");
  });

  it("says the data is silent about what a terrain outside the resource table holds", () => {
    const html = terrainMarkup("terrain:cavern");
    expect(html).toContain(">Movement cost</span><span class=\"text-ink\">1</span>");
    expect(html).toContain("The game data does not say what is found here.");
    expect(html).toMatch(/game-data-link-monster:WORM"[^>]*>giant worm<\/button>/);
  });

  it("says no region sold recruits when no report has been loaded", () => {
    const html = terrainMarkup("terrain:mountain", NO_RECRUIT_SIGHTINGS);
    expect(html).toContain("No mountain region in your reports has had recruits for sale.");
  });

  it("lists where an item is found on its own page", () => {
    const html = terrainMarkup("equipment:MITH");
    expect(html).toContain(">Found in</h3>");
    expect(html).toMatch(/game-data-link-terrain:mountain"[^>]*>mountain<\/button><span class="text-ink-dim">in 35% of regions<\/span>/);
  });

  it("leaves an item found nowhere unchanged", () => {
    expect(terrainMarkup("equipment:SWOR")).not.toContain("Found in");
  });

  it("links a monster to the terrains it roams", () => {
    const html = terrainMarkup("monster:WORM");
    expect(html).toContain(">Roams</span>");
    expect(html).toMatch(/game-data-link-terrain:cavern"[^>]*>cavern<\/button><\/span><span>, <button[^>]*game-data-link-terrain:tunnels"[^>]*>tunnels<\/button>/);
    expect(terrainMarkup("equipment:SWOR")).not.toContain(">Roams<");
  });

  it("shows an empty Terrains tab as every empty tab is shown", () => {
    const html = renderToStaticMarkup(
      <GameDataDialog index={index} initialEntryId={null} onDismiss={() => {}} />
    );
    expect(html).toContain(">Terrains 0</button>");
  });
});
