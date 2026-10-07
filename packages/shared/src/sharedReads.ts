/**
 * Reads the stores share when a game opens.
 *
 * Opening a game starts several stores at once - battle skills, resource verdicts, passages - and
 * each walks every stored turn on its own: lists them, loads each one, parses each report. With
 * thirty turns stored that is the same thirty reports loaded three times and parsed twice. Rather
 * than make the stores know about each other, the client they are handed answers a read it has just
 * answered from what it already has.
 *
 * Only the reads named below are shared, and only briefly: a result is kept a few seconds - long
 * enough for the stores opening together, short enough not to hold every report of a long game - and
 * anything that writes forgets them all, so a re-imported turn is read afresh.
 */

/**
 * The reads shared: storage reads, and answers that depend on nothing but their arguments - the
 * known map among them, which reopening a game resolves twice from the same report and memory.
 */
const SHARED = new Set([
  "knownMap",
  "listImportedTurns",
  "loadImportedTurn",
  "loadLatestImportedTurn",
  "loadOrderDraft",
  "loadRegionSightings",
  "parseReportFull",
  "rosterSkills"
]);

/** A method that changes what is stored: calling one forgets every read kept. */
const WRITES = /^(save|delete|reset|import|commit|merge|create|edit)/;

/** How long a read is kept after it was asked for. */
const KEEP_MS = 10_000;

export function sharedReads<T extends object>(client: T): T {
  const kept = new Map<string, { result: Promise<unknown>; until: number }>();
  const wrappers = new Map<string, (...args: unknown[]) => unknown>();

  const shared = (name: string, method: (...args: unknown[]) => unknown) => (...args: unknown[]) => {
    const key = `${name}\u0000${JSON.stringify(args)}`;
    const now = Date.now();
    const hit = kept.get(key);
    if (hit && hit.until > now) {
      return hit.result;
    }
    const result = Promise.resolve(method.apply(client, args));
    kept.set(key, { result, until: now + KEEP_MS });
    // A failure is not kept: the next caller should try for itself.
    result.catch(() => {
      if (kept.get(key)?.result === result) {
        kept.delete(key);
      }
    });
    return result;
  };

  const writing = (method: (...args: unknown[]) => unknown) => (...args: unknown[]) => {
    kept.clear();
    return method.apply(client, args);
  };

  return new Proxy(client, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== "function" || typeof property !== "string") {
        return value;
      }
      const method = value as (...args: unknown[]) => unknown;
      let wrapper = wrappers.get(property);
      if (!wrapper) {
        wrapper = SHARED.has(property)
          ? shared(property, method)
          : WRITES.test(property)
            ? writing(method)
            : (...args: unknown[]) => method.apply(target, args);
        wrappers.set(property, wrapper);
      }
      return wrapper;
    }
  });
}
