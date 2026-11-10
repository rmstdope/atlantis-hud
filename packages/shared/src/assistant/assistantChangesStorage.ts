/**
 * The assistant changes list, kept across a restart, a reload and a game switch (ah-bcdri).
 *
 * In localStorage rather than the game's database, like the saved map view
 * (`workspace/mapViewportStorage.ts`): it only remembers a review of what is already in the orders,
 * so storage that is missing, blocked or corrupt reads as nothing listed and never throws. One key
 * per game, holding one list per faction, each for the turn it belongs to.
 */

import { optionalStorage, type ViewportStorage } from "../workspace/mapViewportStorage";
import { NO_ASSISTANT_CHANGES, type AssistantChange, type AssistantChangesState } from "./assistantChanges";

/** Whose list: a game, a faction in it, and the turn open. */
export type AssistantChangesScope = { gameId: string; factionId: string; turn: number };

type StoredList = AssistantChangesState & { turn: number };
type StoredLists = Record<string, StoredList>;

function storageKey(gameId: string): string {
  return `atlantis-hud-assistant-changes-v1-${gameId}`;
}

function isChange(value: unknown): value is AssistantChange {
  const change = value as Partial<AssistantChange> | null;
  return (
    typeof change === "object" &&
    change !== null &&
    typeof change.unitId === "string" &&
    typeof change.before === "string" &&
    typeof change.after === "string"
  );
}

function isList(value: unknown): value is StoredList {
  const list = value as Partial<StoredList> | null;
  return (
    typeof list === "object" &&
    list !== null &&
    typeof list.turn === "number" &&
    typeof list.open === "boolean" &&
    Array.isArray(list.changes) &&
    list.changes.every(isChange)
  );
}

function readLists(gameId: string, storage: ViewportStorage): StoredLists {
  const parsed = JSON.parse(storage.getItem(storageKey(gameId)) ?? "{}") as unknown;
  return typeof parsed === "object" && parsed !== null ? (parsed as StoredLists) : {};
}

/** As `readLists`, except a record that cannot be read is written over rather than kept for ever. */
function readListsToReplace(gameId: string, storage: ViewportStorage): StoredLists {
  try {
    return readLists(gameId, storage);
  } catch {
    return {};
  }
}

function writeLists(gameId: string, lists: StoredLists, storage: ViewportStorage): void {
  if (Object.keys(lists).length === 0) {
    storage.removeItem(storageKey(gameId));
  } else {
    storage.setItem(storageKey(gameId), JSON.stringify(lists));
  }
}

/** The list for `scope`. One kept for any other turn is removed: a new turn empties it for good. */
export function loadAssistantChanges(
  scope: AssistantChangesScope,
  storage: ViewportStorage | null = optionalStorage()
): AssistantChangesState {
  if (storage === null) {
    return NO_ASSISTANT_CHANGES;
  }
  try {
    const lists = readLists(scope.gameId, storage);
    const list: unknown = lists[scope.factionId];
    if (!isList(list)) {
      return NO_ASSISTANT_CHANGES;
    }
    if (list.turn !== scope.turn) {
      delete lists[scope.factionId];
      writeLists(scope.gameId, lists, storage);
      return NO_ASSISTANT_CHANGES;
    }
    return { open: list.open, changes: list.changes };
  } catch {
    return NO_ASSISTANT_CHANGES;
  }
}

/** Keeps the list for `scope`. An empty one is simply not kept. */
export function saveAssistantChanges(
  scope: AssistantChangesScope,
  state: AssistantChangesState,
  storage: ViewportStorage | null = optionalStorage()
): void {
  if (storage === null) {
    return;
  }
  try {
    const lists = readListsToReplace(scope.gameId, storage);
    if (state.changes.length === 0) {
      delete lists[scope.factionId];
    } else {
      lists[scope.factionId] = { turn: scope.turn, open: state.open, changes: state.changes };
    }
    writeLists(scope.gameId, lists, storage);
  } catch {
    // The orders are already saved; at worst this list does not come back.
  }
}

/** Drops every list `gameId` has. For a game deleted or emptied, whose turns may come back. */
export function forgetAssistantChanges(
  gameId: string,
  storage: ViewportStorage | null = optionalStorage()
): void {
  try {
    storage?.removeItem(storageKey(gameId));
  } catch {
    // Nothing here is critical.
  }
}
