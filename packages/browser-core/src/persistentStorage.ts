/**
 * Asking the browser not to throw the player's games away.
 *
 * Everything the web build owns lives in IndexedDB, and until an origin asks, that storage is
 * classed "best-effort" - which permits the browser to discard it when it wants space. Asking moves
 * it to "persistent", where it is kept until the player removes it themselves.
 *
 * Whether the request is granted is the browser's decision, made on its own heuristics, and an
 * installed application is treated far more favourably than a tab somebody opened once. So this is
 * worth calling and not worth depending on: where it is refused nothing is lost that was not
 * already at risk, and where it is granted a season of turns stops being evictable.
 *
 * It is not a backup. Persistent storage survives storage pressure; it does not survive a player
 * clearing their browsing data, and it is still one copy on one device. That is issue #50.
 */

export type PersistenceOutcome =
  /** The browser will keep this data until the player removes it. */
  | "persisted"
  /** The browser was asked and said no. Ordinary, and not an error. */
  | "denied"
  /** No API to ask with, or it would not answer. */
  | "unsupported";

/**
 * Requests persistent storage, and says what came back.
 *
 * The storage manager is a parameter rather than read from `navigator` inside, so the outcomes
 * above can be tested without a browser.
 */
export async function requestPersistentStorage(
  storage: StorageManager | undefined = globalThis.navigator?.storage
): Promise<PersistenceOutcome> {
  if (typeof storage?.persist !== "function" || typeof storage.persisted !== "function") {
    return "unsupported";
  }

  try {
    // Asked first, because a repeat request is a prompt in some browsers and there is nothing to
    // prompt about when the answer is already yes.
    if (await storage.persisted()) {
      return "persisted";
    }
    return (await storage.persist()) ? "persisted" : "denied";
  } catch {
    // Safari has historically rejected here rather than resolving false. A startup path that dies
    // because storage would not answer a question is worse than one that carries on unasked.
    return "unsupported";
  }
}
