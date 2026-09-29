import { describe, expect, it } from "vitest";
import {
  mapSizesDraftFor,
  mapSizesDraftOf,
  mapSizesFromDraft,
  mapSizesOfGame,
  mapSizesSummary,
  shrunkLevel,
  mapSizesProblems,
  mapDraftFor,
  mapFromDraft,
  mapShapeJson,
  mapShapeOfGame,
  mapShapeAtLevel,
  mapShapeOfSizes,
  mapShapeProblems
} from "./mapShape";

describe("the map sizes a game can configure", () => {
  it("starts New Origins with only its surface size", () => {
    expect(mapSizesDraftFor("neworigins")).toMatchObject({
      surface: { width: "72", height: "96" },
      underworld: { width: "", height: "" },
      underdeep: { width: "", height: "" },
      dungeon: { width: "", height: "" },
      wrapX: true,
      wrapY: false
    });
  });

  it.each(["newage-arcanum", "newage-trident"])(
    "starts %s with every supported level's default size",
    (rulesetId) => {
      expect(mapSizesDraftFor(rulesetId)).toMatchObject({
        surface: { width: "64", height: "64" },
        underworld: { width: "48", height: "48" },
        underdeep: { width: "24", height: "24" },
        dungeon: { width: "128", height: "32" },
        wrapX: true,
        wrapY: false
      });
    }
  );

  it("keeps blank levels out of the saved configuration", () => {
    const draft = mapSizesDraftFor("neworigins");

    expect(mapSizesFromDraft(draft)).toEqual({
      levels: { surface: { width: 72, height: 96 } },
      wrapX: true,
      wrapY: false
    });
  });

  it("refuses a level with only one dimension", () => {
    const draft = mapSizesDraftFor("neworigins");
    draft.underworld.width = "48";

    expect(mapSizesProblems(draft)).toEqual([
      "Underworld needs both a width and a height, or neither."
    ]);
    expect(mapSizesFromDraft(draft)).toBeNull();
  });
});

describe("the map a game is played on", () => {
  it("takes the player's own answer when the game recorded one", () => {
    const shape = mapShapeOfGame("neworigins", { width: 40, height: 40, wrapX: false, wrapY: true });

    expect(shape).toEqual({
      map: { width: 40, height: 40, wrapX: false, wrapY: true },
      stated: true
    });
  });

  it("falls back to the ruleset's declared map, and says it is only assumed", () => {
    // The navigator's answer for games that predate the question: adopt the default rather than
    // interrupting, and let Settings say it was assumed.
    const shape = mapShapeOfGame("neworigins", undefined);

    expect(shape).toEqual({
      map: { width: 72, height: 96, wrapX: true, wrapY: false },
      stated: false
    });
  });

  it("has no map at all when the ruleset declares none either", () => {
    expect(mapShapeOfGame("no-such-ruleset", undefined)).toEqual({ map: null, stated: false });
  });

  it("writes the shape the core reads", () => {
    expect(JSON.parse(mapShapeJson({ width: 72, height: 96, wrapX: true, wrapY: false }))).toEqual({
      width: 72,
      height: 96,
      wrapX: true,
      wrapY: false
    });
  });

  it("writes an empty string for no map, which is how the core hears 'do not wrap'", () => {
    // Not "null" and not "{}": the core reads an empty string as "the game never said", and
    // anything else would have it guess a seam.
    expect(mapShapeJson(null)).toBe("");
  });
});

describe("the map fields a create form offers", () => {
  it("prefills from the chosen ruleset", () => {
    expect(mapDraftFor("neworigins")).toEqual({
      width: "72",
      height: "96",
      wrapX: true,
      wrapY: false
    });
  });

  it("offers nothing to prefill for a ruleset that declares no map", () => {
    // Better empty than a stale 72x96 under a variant that is not New Origins: a wrong value that
    // looks deliberate is worse than no value at all.
    expect(mapDraftFor("no-such-ruleset")).toEqual({
      width: "",
      height: "",
      wrapX: false,
      wrapY: false
    });
  });

  it("reads the four values a player left alone", () => {
    expect(mapFromDraft({ width: "72", height: "96", wrapX: true, wrapY: false })).toEqual({
      width: 72,
      height: 96,
      wrapX: true,
      wrapY: false
    });
  });

  it("records nothing when the player cleared the dimensions", () => {
    // Nothing recorded means the ruleset default is assumed, which is exactly right for a player
    // who does not know their map's size - and better than storing a zero.
    expect(mapFromDraft({ width: "", height: "", wrapX: true, wrapY: false })).toBeNull();
  });

  it("records nothing rather than a nonsense map", () => {
    expect(mapFromDraft({ width: "wide", height: "96", wrapX: true, wrapY: false })).toBeNull();
    expect(mapFromDraft({ width: "0", height: "96", wrapX: true, wrapY: false })).toBeNull();
    expect(mapFromDraft({ width: "-72", height: "96", wrapX: true, wrapY: false })).toBeNull();
  });
});

describe("wrapping a hex lattice cannot support", () => {
  it("an odd width cannot wrap east-west", () => {
    expect(mapShapeProblems({ width: "71", height: "96", wrapX: true, wrapY: false })).toEqual([
      {
        axis: "x",
        message:
          "A 71-wide map cannot wrap east-west: the eastern and western edges would sit half a hex out of step. Use an even width, or turn off east-west wrap."
      }
    ]);
  });

  it("an odd height cannot wrap north-south", () => {
    expect(mapShapeProblems({ width: "72", height: "95", wrapX: false, wrapY: true })).toEqual([
      {
        axis: "y",
        message:
          "A 95-high map cannot wrap north-south: the northern and southern edges would sit half a hex out of step. Use an even height, or turn off north-south wrap."
      }
    ]);
  });

  it("an even span is fine", () => {
    expect(mapShapeProblems({ width: "72", height: "96", wrapX: true, wrapY: true })).toEqual([]);
  });

  it("wrapping that is off is never a problem", () => {
    expect(mapShapeProblems({ width: "71", height: "95", wrapX: false, wrapY: false })).toEqual([]);
  });

  it("reports both axes when both are wrong", () => {
    const problems = mapShapeProblems({ width: "71", height: "95", wrapX: true, wrapY: true });

    expect(problems.map((problem) => problem.axis)).toEqual(["x", "y"]);
  });

  it("says nothing about a draft whose dimensions cannot be read", () => {
    // An unreadable width states no map, and a map nobody stated wraps nowhere - a parity message
    // here would be an error about an absence.
    expect(mapShapeProblems({ width: "abc", height: "", wrapX: true, wrapY: true })).toEqual([]);
  });
});

describe("a game that already carries wrapping that cannot be drawn", () => {
  it("reads a recorded odd width without east-west wrap", () => {
    expect(mapShapeOfGame("neworigins", { width: 71, height: 96, wrapX: true, wrapY: true })).toEqual(
      { map: { width: 71, height: 96, wrapX: false, wrapY: true }, stated: true }
    );
  });

  it("reads a recorded odd height without north-south wrap", () => {
    expect(mapShapeOfGame("neworigins", { width: 72, height: 95, wrapX: true, wrapY: true })).toEqual(
      { map: { width: 72, height: 95, wrapX: true, wrapY: false }, stated: true }
    );
  });

  it("returns the very object it was given when nothing needs turning off", () => {
    // Identity, not just equality: the shell memoises on the map's identity.
    const recorded = { width: 72, height: 96, wrapX: true, wrapY: true };

    expect(mapShapeOfGame("neworigins", recorded).map).toBe(recorded);
  });

  it("returns a recorded shape that is fine unchanged", () => {
    expect(mapShapeOfGame("neworigins", { width: 72, height: 96, wrapX: true, wrapY: true })).toEqual(
      { map: { width: 72, height: 96, wrapX: true, wrapY: true }, stated: true }
    );
  });

  it("leaves the manifest it was given alone", () => {
    const recorded = { width: 71, height: 96, wrapX: true, wrapY: false };

    mapShapeOfGame("neworigins", recorded);

    expect(recorded).toEqual({ width: 71, height: 96, wrapX: true, wrapY: false });
  });
});

describe("an existing world's map sizes (ah-4hwa)", () => {
  const trident = {
    levels: {
      surface: { width: 64, height: 64 },
      underworld: { width: 48, height: 48 },
      dungeon: { width: 128, height: 32 }
    },
    wrapX: true,
    wrapY: false
  };

  it("summarises every level on a line of its own, naming the ones not configured", () => {
    expect(mapSizesSummary(trident)).toEqual([
      "Surface 64 × 64",
      "Underworld 48 × 48",
      "Underdeep not configured",
      "Dungeon 128 × 32",
      "Wraps east to west"
    ]);
  });

  it("names both wraps, or neither", () => {
    expect(mapSizesSummary({ ...trident, wrapY: true }).at(-1)).toBe("Wraps east to west and north to south");
    expect(mapSizesSummary({ ...trident, wrapX: false }).at(-1)).toBe("Does not wrap");
  });

  it("says so when no level is configured", () => {
    expect(mapSizesSummary(null)).toEqual(["No map levels configured."]);
    expect(mapSizesSummary({ levels: {}, wrapX: true, wrapY: false })).toEqual(["No map levels configured."]);
  });

  it("reads a recorded configuration as it is", () => {
    expect(mapSizesOfGame(trident, { width: 72, height: 96, wrapX: true, wrapY: false })).toBe(trident);
  });

  it("reads a game created before map levels as a surface-only configuration", () => {
    expect(mapSizesOfGame(undefined, { width: 72, height: 96, wrapX: true, wrapY: true })).toEqual({
      levels: { surface: { width: 72, height: 96 } },
      wrapX: true,
      wrapY: true
    });
    expect(mapSizesOfGame(undefined, null)).toBeNull();
  });

  it("fills an editing draft from the configuration", () => {
    expect(mapSizesDraftOf(trident)).toEqual({
      surface: { width: "64", height: "64" },
      underworld: { width: "48", height: "48" },
      underdeep: { width: "", height: "" },
      dungeon: { width: "128", height: "32" },
      wrapX: true,
      wrapY: false
    });
  });

  it("finds the first configured level made smaller or removed", () => {
    const next = { ...trident, levels: { ...trident.levels, underworld: { width: 48, height: 40 } } };
    expect(shrunkLevel(trident, next)).toEqual({ level: "underworld", field: "height" });
    const removed = { ...trident, levels: { surface: trident.levels.surface, underworld: trident.levels.underworld } };
    expect(shrunkLevel(trident, removed)).toEqual({ level: "dungeon", field: "width" });
  });

  it("does not ask about a level added, grown, or a wrapping change", () => {
    const next = {
      levels: { ...trident.levels, surface: { width: 80, height: 64 }, underdeep: { width: 24, height: 24 } },
      wrapX: false,
      wrapY: true
    };
    expect(shrunkLevel(trident, next)).toBeNull();
    expect(shrunkLevel(null, next)).toBeNull();
  });
});

describe("each level's own shape (ah-byqe)", () => {
  const trident = {
    levels: {
      surface: { width: 64, height: 64 },
      underworld: { width: 48, height: 48 },
      dungeon: { width: 128, height: 32 }
    },
    wrapX: true,
    wrapY: false
  };

  it("records every configured level, headed by the surface", () => {
    expect(mapShapeOfSizes(trident)).toEqual({ width: 64, height: 64, wrapX: true, wrapY: false, levels: trident.levels });
  });

  it("records the other levels even without a surface", () => {
    const shape = mapShapeOfSizes({ levels: { underworld: { width: 48, height: 48 } }, wrapX: true, wrapY: false });
    expect(shape).toMatchObject({ width: 0, height: 0, levels: { underworld: { width: 48, height: 48 } } });
  });

  it("records nothing when no level is configured", () => {
    expect(mapShapeOfSizes({ levels: {}, wrapX: true, wrapY: false })).toBeUndefined();
  });

  it("gives each level its own size with the shared wrapping", () => {
    const shape = mapShapeOfSizes(trident) ?? null;
    expect(mapShapeAtLevel(shape, 1)).toEqual({ width: 64, height: 64, wrapX: true, wrapY: false });
    expect(mapShapeAtLevel(shape, 2)).toEqual({ width: 48, height: 48, wrapX: true, wrapY: false });
    expect(mapShapeAtLevel(shape, 4)).toEqual({ width: 128, height: 32, wrapX: true, wrapY: false });
  });

  it("gives an unconfigured level no shape", () => {
    const shape = mapShapeOfSizes(trident) ?? null;
    expect(mapShapeAtLevel(shape, 3)).toBeNull();
    expect(mapShapeAtLevel(shape, 0)).toBeNull();
  });

  it("applies a shape recorded without levels to every level", () => {
    const legacy = { width: 72, height: 96, wrapX: true, wrapY: false };
    expect(mapShapeAtLevel(legacy, 2)).toBe(legacy);
    expect(mapShapeAtLevel(null, 1)).toBeNull();
  });

  it("keeps the levels when wrapping that cannot be drawn is turned off", () => {
    const recorded = { width: 71, height: 64, wrapX: true, wrapY: false, levels: { underworld: { width: 48, height: 48 } } };
    expect(mapShapeOfGame("neworigins", recorded).map).toMatchObject({ wrapX: false, levels: recorded.levels });
  });
});
