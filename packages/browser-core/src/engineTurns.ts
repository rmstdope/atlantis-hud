/**
 * Moving a row a game database stored below version 7 to the engine's turn numbers (ah-m6pw).
 *
 * Those rows were written while the core called February of Year 1 turn 1. The engine's own
 * `Game::TurnNumber` (game.cpp) is `(year - 1) * 12 + month + 1` with January as month 0, so
 * January of Year 1 is turn 1 and every stored turn is one low. Every turn a row names moves up by
 * one - the move the desktop's migration 15 and a version-1 backup's restore make too - so a report
 * imported after the upgrade lands on the key its earlier copy now holds, and every comparison the
 * stored rows already made (which sighting is newer, how stale a hex is) comes out as before.
 *
 * Pure, and kept apart from the store, because vitest has no IndexedDB: the upgrade in
 * `webStore.ts` only walks each store and writes back what this returns (`moveStoreToEngineTurns`).
 */

type Row = Record<string, unknown>;

function later(value: unknown): unknown {
  return typeof value === "number" ? value + 1 : value;
}

/** A goal's turn 0 marks one written before goals had turns, which every reader drops. */
function laterUnlessZero(value: unknown): unknown {
  return typeof value === "number" && value > 0 ? value + 1 : value;
}

function withLater(row: Row, field: string, move: (value: unknown) => unknown = later): Row {
  return field in row ? { ...row, [field]: move(row[field]) } : row;
}

function eachLater(list: unknown, field: string, move: (value: unknown) => unknown): unknown {
  return Array.isArray(list)
    ? list.map((entry: unknown) =>
        typeof entry === "object" && entry !== null ? withLater(entry as Row, field, move) : entry
      )
    : list;
}

/** The payload under either spelling it was ever stored with; one that does not read is kept. */
function payloadLater(payloadJson: unknown): unknown {
  if (typeof payloadJson !== "string") {
    return payloadJson;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(payloadJson);
  } catch {
    return payloadJson;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return payloadJson;
  }
  const payload = parsed as Row;
  for (const [headerKey, turnKey] of [
    ["turnHeader", "turnNumber"],
    ["turn_header", "turn_number"]
  ] as const) {
    const header = payload[headerKey];
    if (typeof header === "object" && header !== null) {
      payload[headerKey] = withLater(header as Row, turnKey);
    }
  }
  return JSON.stringify(payload);
}

/** The row with every turn it names one higher; a store that holds no turn gets the row back. */
export function moveRowToEngineTurns<T extends Row>(storeName: string, row: T): T {
  switch (storeName) {
    case "importedTurns":
      return {
        ...withLater(row, "turnNumber"),
        ...("parsedPayloadJson" in row
          ? { parsedPayloadJson: payloadLater(row.parsedPayloadJson) }
          : {})
      } as T;
    case "orderDrafts":
    case "mergedReports":
      return withLater(row, "turnNumber") as T;
    case "regionSightings":
      return withLater(row, "lastSeenTurn") as T;
    case "hexNotes":
      return withLater(row, "turn") as T;
    case "alliedMages":
      return withLater(row, "sheetTurn") as T;
    case "armies":
      return withLater(row, "members", (members) => eachLater(members, "seenTurn", later)) as T;
    case "studyPlans":
      return withLater(
        withLater(row, "goals", (goals) => eachLater(goals, "turn", laterUnlessZero)),
        // A cast has no turnless form, so one on turn 0 (January of Year 1, as counted before)
        // moves like any other.
        "casts",
        (casts) => eachLater(casts, "turn", later)
      ) as T;
    default:
      return row;
  }
}

/** Every store whose rows name a turn, which a version-7 upgrade rewrites. */
export const STORES_NAMING_A_TURN = [
  "importedTurns",
  "orderDrafts",
  "mergedReports",
  "regionSightings",
  "hexNotes",
  "alliedMages",
  "armies",
  "studyPlans"
] as const;
