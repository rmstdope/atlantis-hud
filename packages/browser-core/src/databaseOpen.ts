/**
 * Opening and deleting an IndexedDB database without waiting for ever on another tab.
 *
 * IndexedDB fires `blocked` only at the request whose upgrade is waiting on other connections. A
 * second open queued behind that pending upgrade hears nothing at all, and waits for as long as
 * the other tab keeps its connection - which, for a tab from an older build, is for ever. So the
 * wait is bounded by a clock rather than by an event.
 *
 * Kept apart from the store and given a timer seam so it can be tested: vitest has no IndexedDB.
 */

import {
  StorageHeldElsewhereError,
  type StorageHeldScope,
  type StorageStopCause
} from "@atlantis/core-client";

/** How long an open or delete may wait on other tabs before the tab says so. */
export const HELD_WAIT_MS = 4_000;
/** How long listeners get to save before a released tab closes its connections. */
export const STOP_SAVE_BUDGET_MS = 2_000;

export type Timers = {
  set: (callback: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
};

export const realTimers: Timers = {
  set: (callback, ms) => globalThis.setTimeout(callback, ms),
  clear: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>)
};

/**
 * Settles an open request: resolves with the database, rejects with its error, or rejects with
 * StorageHeldElsewhereError(scope) when neither `upgradeneeded` nor `success` nor `error` has fired
 * within HELD_WAIT_MS. `blocked` on its own changes nothing - the other tab may be about to let go.
 * A success that lands after the wait gave up closes that connection at once.
 */
export function openWithin(
  request: IDBOpenDBRequest,
  scope: StorageHeldScope,
  upgrade: (database: IDBDatabase) => void,
  timers: Timers = realTimers,
  waitMs: number = HELD_WAIT_MS
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer: unknown = timers.set(() => {
      timer = null;
      if (!settled) {
        settled = true;
        reject(new StorageHeldElsewhereError(scope));
      }
    }, waitMs);
    const stopWaiting = () => {
      if (timer !== null) {
        timers.clear(timer);
        timer = null;
      }
    };

    request.onupgradeneeded = () => {
      // The other tabs have let go: this tab is no longer held, however long the upgrade takes.
      stopWaiting();
      upgrade(request.result);
    };
    request.onsuccess = () => {
      stopWaiting();
      if (settled) {
        // Nobody is waiting for this connection any more, and keeping it would hold the database
        // against the very tab that is in the way.
        request.result.close();
        return;
      }
      settled = true;
      resolve(request.result);
    };
    request.onerror = () => {
      stopWaiting();
      if (!settled) {
        settled = true;
        reject(request.error ?? new Error("failed to open indexeddb"));
      }
    };
  });
}

/** The same wait for `indexedDB.deleteDatabase`; always scope "game". Late success is ignored. */
export function deleteWithin(
  request: IDBOpenDBRequest,
  timers: Timers = realTimers,
  waitMs: number = HELD_WAIT_MS
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = timers.set(() => {
      if (!settled) {
        settled = true;
        reject(new StorageHeldElsewhereError("game"));
      }
    }, waitMs);

    request.onsuccess = () => {
      timers.clear(timer);
      if (!settled) {
        settled = true;
        resolve();
      }
    };
    request.onerror = () => {
      timers.clear(timer);
      if (!settled) {
        settled = true;
        reject(request.error ?? new Error("failed to delete indexeddb"));
      }
    };
  });
}

/** `versionchange` newVersion -> cause: null (a delete) is "other", any number is "update". */
export function stopCauseOf(newVersion: number | null): StorageStopCause {
  return newVersion === null ? "other" : "update";
}
