import type { StoreApi } from "zustand";

/**
 * Test-only helpers. **Nothing in production may import this module**, and
 * `packages/shared/src/index.ts` must not re-export it: there is no build step here, so a module
 * nothing imports is a module nothing ships, and that is the whole point of this directory.
 */

/**
 * A zustand store as `create()` returns one: the store API plus the React binding's
 * `getInitialState`, which is what a server render reads.
 */
export type TestableStore<T> = StoreApi<T> & { getInitialState: () => T };

type Snapshot = { state: unknown; initial: unknown };

const snapshots = new Map<TestableStore<never>, Snapshot>();

/**
 * Makes a store's state visible to a `renderToStaticMarkup` render.
 *
 * Applies `patch` when given, then mirrors the store's whole current state onto the object
 * `getInitialState()` returns - which is what React's server branch reads through
 * `useSyncExternalStore`'s `getServerSnapshot`, and the reason a plain `setState` before a static
 * render changes nothing. Call it with no patch after driving the store through its own actions.
 *
 * Every store it touches is snapshotted the **first** time, so `restoreStoresForTest()` puts them
 * back exactly as they were then - the mutation outlives a `setState`-only reset and would
 * otherwise leak into the next test in the file. That first call is what fixes the restore point:
 * if it happens after an action, restore rolls back to the post-action state. To roll back to the
 * pristine store, call `setStoreStateForTest(store)` once before driving the action - to take the
 * snapshot - and again after it, to mirror.
 */
export function setStoreStateForTest<T>(store: TestableStore<T>, patch?: Partial<T>): void {
  const key = store as unknown as TestableStore<never>;
  if (!snapshots.has(key)) {
    snapshots.set(key, {
      state: { ...store.getState() },
      initial: { ...store.getInitialState() }
    });
  }
  if (patch) {
    store.setState(patch);
  }
  Object.assign(store.getInitialState() as object, store.getState());
}

/** Undoes every `setStoreStateForTest` this file has made. Call it in `afterEach`. */
export function restoreStoresForTest(): void {
  for (const [store, snapshot] of snapshots) {
    store.setState(snapshot.state as never, true);
    Object.assign(store.getInitialState() as object, snapshot.initial as object);
  }
  snapshots.clear();
}
