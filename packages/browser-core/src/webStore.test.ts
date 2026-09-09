/**
 * The in-memory store, which is both the test double and the fallback a private window gets.
 *
 * Only the merged-report store is covered here, because it is the one this file's contract gained
 * with issue #53 and the one a mistake in would be silent: a merge that is not recorded still grows
 * the map, so nothing visibly fails - the player just cannot see whose eyes they are looking
 * through after a reload. The IndexedDB half cannot be reached from vitest, which has no
 * `indexedDB`; its upgrade path is proved in the Playwright suite instead.
 */

import { describe, expect, it } from "vitest";
import {
  createMemoryWebStore,
  gameCollections,
  type StoredAlliedMage,
  type StoredArmy,
  type StoredHexNote,
  type StoredMergedReport,
  type StoredOrderDraft,
  type StoredRegionSighting,
  type StoredStudyPlan,
  type StoredTurn
} from "./webStore";

const DB = "idb://game-95";

function merge(overrides: Partial<StoredMergedReport> = {}): StoredMergedReport {
  return {
    databasePath: DB,
    gameId: "faction-95",
    factionId: "95",
    turnNumber: 71,
    mergedFactionId: "73",
    mergedFactionName: "Borg",
    mergedAt: "2026-08-10T18:30:00Z",
    ...overrides
  };
}

function note(overrides: Partial<StoredHexNote> = {}): StoredHexNote {
  return {
    databasePath: DB,
    id: "note-1",
    gameId: "faction-95",
    regionId: "1:7,53",
    text: "Mustn't forget the mountain pass",
    onMap: true,
    turn: 71,
    createdAt: "2026-08-10T18:30:00Z",
    updatedAt: "2026-08-10T18:30:00Z",
    ...overrides
  };
}

describe("remembering which allied reports were merged", () => {
  it("reads back what was written", async () => {
    const store = createMemoryWebStore();

    await store.putMergedReport(merge());

    await expect(store.getMergedReports(DB, "faction-95", "95", 71)).resolves.toEqual([merge()]);
  });

  /** Merging the same ally twice is a statement about the map, not two entries in a log. */
  it("keeps one record per ally, restamped", async () => {
    const store = createMemoryWebStore();

    await store.putMergedReport(merge());
    await store.putMergedReport(merge({ mergedAt: "2026-08-10T21:00:00Z" }));

    const records = await store.getMergedReports(DB, "faction-95", "95", 71);
    expect(records).toHaveLength(1);
    expect(records[0].mergedAt).toBe("2026-08-10T21:00:00Z");
  });

  /** A merge belongs to the turn it was made in, so next turn's map starts from nobody. */
  it("keeps each turn's merges to itself", async () => {
    const store = createMemoryWebStore();

    await store.putMergedReport(merge());

    await expect(store.getMergedReports(DB, "faction-95", "95", 72)).resolves.toEqual([]);
  });

  /** Two factions in one game keep separate maps, so they keep separate accounts of who fed them. */
  it("keeps each faction's merges to itself", async () => {
    const store = createMemoryWebStore();

    await store.putMergedReport(merge());

    await expect(store.getMergedReports(DB, "faction-95", "73", 71)).resolves.toEqual([]);
  });

  it("forgets them along with the game they belonged to", async () => {
    const store = createMemoryWebStore();
    await store.putGame({
      gameId: "faction-95",
      databasePath: DB,
      schemaVersion: 1,
      manifest: null
    });
    await store.putMergedReport(merge());

    await store.deleteGame("faction-95");

    await expect(store.getMergedReports(DB, "faction-95", "95", 71)).resolves.toEqual([]);
  });
});

/**
 * The store keeps whatever it is told; whether an older report may overwrite a newer sighting is
 * the core's call (`import_writes`), not this store's - see `writes an earlier turn's account
 * when told to` below.
 */
describe("remembering where a faction has been", () => {
  const sighting = (overrides: Partial<StoredRegionSighting> = {}): StoredRegionSighting => ({
    databasePath: DB,
    gameId: "faction-95",
    factionId: "95",
    regionId: "1:9,51",
    lastSeenTurn: 71,
    payloadJson: '{"turn":71}',
    ...overrides
  });

  it("reads back what was written", async () => {
    const store = createMemoryWebStore();

    await store.putRegionSightings([sighting()]);

    await expect(store.getRegionSightings(DB, "faction-95", "95")).resolves.toEqual([sighting()]);
  });

  it("lets a later turn's account of a hex replace an earlier one", async () => {
    const store = createMemoryWebStore();

    await store.putRegionSightings([sighting({ lastSeenTurn: 70, payloadJson: '{"turn":70}' })]);
    await store.putRegionSightings([sighting({ lastSeenTurn: 71, payloadJson: '{"turn":71}' })]);

    const stored = await store.getRegionSightings(DB, "faction-95", "95");
    expect(stored).toHaveLength(1);
    expect(stored[0].payloadJson).toBe('{"turn":71}');
  });

  it("writes an earlier turn's account when told to - which one survives is the core's call", async () => {
    const store = createMemoryWebStore();

    await store.putRegionSightings([sighting({ lastSeenTurn: 71, payloadJson: '{"turn":71}' })]);
    await store.putRegionSightings([sighting({ lastSeenTurn: 70, payloadJson: '{"turn":70}' })]);

    const stored = await store.getRegionSightings(DB, "faction-95", "95");
    expect(stored).toHaveLength(1);
    expect(stored[0].lastSeenTurn).toBe(70);
    expect(stored[0].payloadJson).toBe('{"turn":70}');
  });

  /** Re-importing the same turn refreshes it, exactly as committing that turn again does. */
  it("lets the same turn's account replace itself", async () => {
    const store = createMemoryWebStore();

    await store.putRegionSightings([sighting({ payloadJson: '{"turn":71,"first":true}' })]);
    await store.putRegionSightings([sighting({ payloadJson: '{"turn":71,"first":false}' })]);

    const stored = await store.getRegionSightings(DB, "faction-95", "95");
    expect(stored[0].payloadJson).toBe('{"turn":71,"first":false}');
  });

  /** The guard is per hex: an older report still fills in hexes nothing has been stored for. */
  it("still stores an older account of a hex nothing is known about", async () => {
    const store = createMemoryWebStore();

    await store.putRegionSightings([sighting({ lastSeenTurn: 71 })]);
    await store.putRegionSightings([sighting({ regionId: "1:9,53", lastSeenTurn: 40 })]);

    const stored = await store.getRegionSightings(DB, "faction-95", "95");
    expect(stored.map((entry) => entry.regionId).sort()).toEqual(["1:9,51", "1:9,53"]);
  });
});

describe("storing manual hex notes", () => {
  it("reads back what was written", async () => {
    const store = createMemoryWebStore();

    await store.putHexNote(note({ id: "note-older", createdAt: "2026-08-01T09:00:00Z" }));
    await store.putHexNote(note({ id: "note-newer", createdAt: "2026-08-02T09:00:00Z" }));

    const stored = await store.getHexNotes(DB, "faction-95");
    expect(stored.map((entry) => entry.id).sort()).toEqual(["note-newer", "note-older"]);
  });

  it("deletes a note and reports whether it existed", async () => {
    const store = createMemoryWebStore();
    await store.putHexNote(note());

    await expect(store.deleteHexNote(DB, "faction-95", "note-1")).resolves.toBe(true);
    await expect(store.deleteHexNote(DB, "faction-95", "note-1")).resolves.toBe(false);
    await expect(store.getHexNotes(DB, "faction-95")).resolves.toEqual([]);
  });

  it("keeps one game's notes out of another, and deletes them with the game", async () => {
    const store = createMemoryWebStore();
    await store.putGame({
      gameId: "faction-95",
      databasePath: DB,
      schemaVersion: 1,
      manifest: {}
    });
    await store.putHexNote(note());

    await store.deleteGame("faction-95");

    await expect(store.getHexNotes(DB, "faction-95")).resolves.toEqual([]);
  });
});

/** One row of every per-game collection, so a drop can be asked to forget all of them. */
function aTurn(): StoredTurn {
  return {
    databasePath: DB,
    gameId: "faction-95",
    factionId: "95",
    turnNumber: 71,
    rawReport: "TURN: 71",
    parsedPayloadJson: "{}",
    warningsPayloadJson: "[]"
  };
}

function aDraft(): StoredOrderDraft {
  return {
    databasePath: DB,
    gameId: "faction-95",
    factionId: "95",
    turnNumber: 71,
    orderText: "#atlantis 95",
    updatedAt: "2026-08-10T18:30:00Z"
  };
}

function aSighting(): StoredRegionSighting {
  return {
    databasePath: DB,
    gameId: "faction-95",
    factionId: "95",
    regionId: "1:7,53",
    lastSeenTurn: 71,
    payloadJson: "{}"
  };
}

function anArmy(): StoredArmy {
  return {
    databasePath: DB,
    id: "army-1",
    gameId: "faction-95",
    name: "Escort",
    members: [
      {
        unitId: "1",
        name: "Scouts",
        factionId: "95",
        factionName: "Borg TNG",
        own: true,
        regionId: "1:7,53",
        flags: [],
        items: [],
        skills: [],
        combatSpell: null,
        men: 1,
        seenTurn: 71,
        seenAt: "2026-08-01T09:00:00Z"
      }
    ],
    createdAt: "2026-08-01T09:00:00Z",
    updatedAt: "2026-08-01T09:00:00Z"
  };
}

function aMage(): StoredAlliedMage {
  return {
    databasePath: DB,
    factionId: "21",
    factionName: "Borg",
    unit: {
      unitId: "9001",
      name: "Sweep Mage",
      regionId: "1:7,53",
      factionId: "21",
      factionName: "Borg",
      own: false,
      onGuard: false,
      flags: [],
      items: [{ amount: 1, name: "leader", tag: "LEAD" }],
      skills: [{ name: "force", tag: "FORC", level: 3, points: 180 }],
      combatSpell: { name: "fire", tag: "FIRE" },
      men: 1,
      menEstimated: true,
      menByRace: [],
      weight: null,
      capacity: null,
      movement: null,
      structureId: null,
      read: "complete"
    },
    sheetTurn: 23,
    receivedAt: "2026-08-01T09:00:00Z"
  };
}

function aStudyPlan(): StoredStudyPlan {
  return {
    databasePath: DB,
    factionId: "21",
    unitId: "9001",
    goals: [{ kind: "study", turn: 24, skill: "FORC" }],
    comment: "heading for Gate Lore",
    updatedAt: "2026-08-07T12:00:00Z"
  };
}

describe("dropping a game's data", () => {
  const OTHER = "idb://game-73";

  /**
   * Pinned because the drop names every collection by hand today: a list like that is complete
   * now and one collection short the moment another is added.
   */
  it("forgets every collection the game had", async () => {
    const store = createMemoryWebStore();

    await store.putImportedTurn(aTurn());
    await store.putOrderDraft(aDraft());
    await store.putRegionSightings([aSighting()]);
    await store.putMergedReport(merge());
    await store.putHexNote(note());
    await store.putArmy(anArmy());
    await store.putAlliedMages(DB, [aMage()], []);
    await store.putStudyPlans(DB, [aStudyPlan()], []);

    await store.putMergedReport(merge({ databasePath: OTHER }));
    await store.putHexNote(note({ databasePath: OTHER }));

    await store.dropGameData(DB);

    await expect(store.getImportedTurns(DB, "faction-95")).resolves.toEqual([]);
    await expect(store.getOrderDrafts(DB, "faction-95")).resolves.toEqual([]);
    await expect(store.getAllRegionSightings(DB, "faction-95")).resolves.toEqual([]);
    await expect(store.getAllMergedReports(DB, "faction-95")).resolves.toEqual([]);
    await expect(store.getHexNotes(DB, "faction-95")).resolves.toEqual([]);
    await expect(store.getArmies(DB, "faction-95")).resolves.toEqual([]);
    await expect(store.getAlliedMages(DB, "faction-95")).resolves.toEqual([]);
    await expect(store.getStudyPlans(DB, "faction-95")).resolves.toEqual([]);

    await expect(store.getAllMergedReports(OTHER, "faction-73")).resolves.toEqual([
      merge({ databasePath: OTHER })
    ]);
    await expect(store.getHexNotes(OTHER, "faction-73")).resolves.toEqual([
      note({ databasePath: OTHER })
    ]);
  });
});

describe("the per-game collections", () => {
  /**
   * The dotted key path is the one a mistake in would be silent: written as `unitId`, every allied
   * mage keys on `undefined` and a second mage overwrites the first.
   */
  it("declares every game store, and keys an allied mage by his faction and the unit inside him", () => {
    expect(gameCollections.map((collection) => collection.name)).toEqual([
      "importedTurns",
      "orderDrafts",
      "regionSightings",
      "mergedReports",
      "hexNotes",
      "armies",
      "alliedMages",
      "studyPlans"
    ]);

    expect(gameCollections.find((collection) => collection.name === "alliedMages")?.keyPath).toEqual(
      ["factionId", "unit.unitId"]
    );
  });
});
