import { describe, expect, it } from "vitest";

import { atlaClientCaps, capAtlaClientSighting } from "./engineTurns";

/**
 * ah-vtgk: before ah-m6pw an AtlaClient map's stamps were already the engine's turns while HUD
 * numbered its own one lower, so a hex merged from one was stored a turn too new, and the move
 * above keeps that difference. The version-8 upgrade caps every sighting of a faction holding an
 * AtlaClient merge at that faction's newest imported turn.
 */
describe("capping a sighting merged from AtlaClient", () => {
  const merges = [
    { factionId: "95", turnNumber: 72, mergedFactionId: "atlaclient" },
    { factionId: "73", turnNumber: 72, mergedFactionId: "21" }
  ];
  const turnKeys = [
    ["95", 71],
    ["95", 72],
    ["73", 72]
  ];

  it("bounds only the factions holding an AtlaClient merge, by their newest turn", () => {
    expect(atlaClientCaps(merges, turnKeys)).toEqual(new Map([["95", 72]]));
  });

  it("brings a sighting newer than the newest turn back to it", () => {
    const caps = atlaClientCaps(merges, turnKeys);

    expect(capAtlaClientSighting({ factionId: "95", regionId: "1:1,1", lastSeenTurn: 73 }, caps))
      .toEqual({ factionId: "95", regionId: "1:1,1", lastSeenTurn: 72 });
  });

  it("leaves a sighting at or before the newest turn, and another faction's, as they were", () => {
    const caps = atlaClientCaps(merges, turnKeys);
    const current = { factionId: "95", regionId: "1:2,2", lastSeenTurn: 72 };
    const older = { factionId: "95", regionId: "1:3,3", lastSeenTurn: 70 };
    const ally = { factionId: "73", regionId: "1:1,1", lastSeenTurn: 73 };

    expect(capAtlaClientSighting(current, caps)).toBe(current);
    expect(capAtlaClientSighting(older, caps)).toBe(older);
    expect(capAtlaClientSighting(ally, caps)).toBe(ally);
  });
});
