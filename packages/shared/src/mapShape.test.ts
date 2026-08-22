import { describe, expect, it } from "vitest";
import { mapDraftFor, mapFromDraft, mapShapeJson, mapShapeOfGame } from "./mapShape";

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
