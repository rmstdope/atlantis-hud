import { describe, expect, it } from "vitest";

import { atlaClientCaps, capAtlaClientSighting, moveRowToEngineTurns } from "./engineTurns";

/**
 * ah-m6pw: a game database below version 7 numbered every turn one low (February of Year 1 was
 * turn 1). These are the rows its upgrade rewrites, one store at a time.
 */
describe("moving a stored row to the engine's turn numbers", () => {
  it("moves an imported turn's key and the turn its parsed payload names", () => {
    const row = {
      factionId: "95",
      turnNumber: 71,
      rawReport: "r",
      parsedPayloadJson: JSON.stringify({
        turnHeader: { turnNumber: 71, season: "December" },
        regions: []
      }),
      warningsPayloadJson: "[]"
    };

    const moved = moveRowToEngineTurns("importedTurns", row);

    expect(moved.turnNumber).toBe(72);
    expect(moved.parsedPayloadJson).toBe(
      '{"turnHeader":{"turnNumber":72,"season":"December"},"regions":[]}'
    );
    expect(row.turnNumber).toBe(71);
  });

  it("moves the snake_case header a payload from before ah-164.1 carries", () => {
    const moved = moveRowToEngineTurns("importedTurns", {
      turnNumber: 2,
      parsedPayloadJson: '{"turn_header":{"turn_number":2,"season":"March"}}'
    });

    expect(moved.parsedPayloadJson).toBe('{"turn_header":{"turn_number":3,"season":"March"}}');
  });

  it("leaves a payload it cannot read as it was", () => {
    expect(
      moveRowToEngineTurns("importedTurns", { turnNumber: 2, parsedPayloadJson: "not json" })
        .parsedPayloadJson
    ).toBe("not json");
  });

  it("moves every other store's turn", () => {
    expect(moveRowToEngineTurns("orderDrafts", { turnNumber: 71 }).turnNumber).toBe(72);
    expect(moveRowToEngineTurns("mergedReports", { turnNumber: 71 }).turnNumber).toBe(72);
    expect(moveRowToEngineTurns("regionSightings", { lastSeenTurn: 68 }).lastSeenTurn).toBe(69);
    expect(moveRowToEngineTurns("hexNotes", { turn: 69 }).turn).toBe(70);
    expect(moveRowToEngineTurns("alliedMages", { sheetTurn: 23 }).sheetTurn).toBe(24);
    expect(
      moveRowToEngineTurns("armies", {
        id: "a1",
        members: [
          { unitId: "1", seenTurn: 66 },
          { unitId: "2", seenTurn: 67 }
        ]
      }).members
    ).toEqual([
      { unitId: "1", seenTurn: 67 },
      { unitId: "2", seenTurn: 68 }
    ]);
  });

  it("moves a plan's goals and casts, but leaves a turnless legacy goal at 0", () => {
    const moved = moveRowToEngineTurns("studyPlans", {
      unitId: "7",
      goals: [
        { kind: "study", turn: 0, skill: "FORC" },
        { kind: "teach", turn: 72, students: [], live: true }
      ],
      casts: [
        { turn: 0, spell: "FIRE" },
        { turn: 72, spell: "FARS" }
      ]
    });

    expect(moved.goals).toEqual([
      { kind: "study", turn: 0, skill: "FORC" },
      { kind: "teach", turn: 73, students: [], live: true }
    ]);
    // A cast has no turnless form, so one on turn 0 moves too.
    expect(moved.casts).toEqual([
      { turn: 1, spell: "FIRE" },
      { turn: 73, spell: "FARS" }
    ]);
  });

  it("carries a plan stored before goals or casts existed through untouched", () => {
    const legacy = { unitId: "7", skill: "FORC" };

    expect(moveRowToEngineTurns("studyPlans", legacy)).toEqual(legacy);
  });

  it("leaves a store that holds no turn alone", () => {
    const row = { id: "x", turn: 5 };

    expect(moveRowToEngineTurns("games", row)).toBe(row);
  });
});

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

  it("caps before the move, so a version-6 row lands on the newest turn after both", () => {
    // Stored on version 6's count: newest report 71, the AtlaClient hex one above it at 72.
    const caps = atlaClientCaps(
      [{ factionId: "95", turnNumber: 71, mergedFactionId: "atlaclient" }],
      [["95", 71]]
    );

    const row = moveRowToEngineTurns(
      "regionSightings",
      capAtlaClientSighting({ factionId: "95", regionId: "1:1,1", lastSeenTurn: 72 }, caps)
    );

    expect(row.lastSeenTurn).toBe(72);
  });
});
