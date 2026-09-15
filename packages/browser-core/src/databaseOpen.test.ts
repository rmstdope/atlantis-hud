import { StorageHeldElsewhereError } from "@atlantis/core-client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deleteWithin, openWithin, stopCauseOf } from "./databaseOpen";

/** Stands in for an IDBOpenDBRequest: the test fires its handlers by hand. */
function fakeRequest() {
  const database = { close: vi.fn() };
  const request = {
    result: database,
    error: null as unknown,
    onsuccess: null as null | (() => void),
    onerror: null as null | (() => void),
    onblocked: null as null | (() => void),
    onupgradeneeded: null as null | (() => void)
  };
  return { request, database, asRequest: request as unknown as IDBOpenDBRequest };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("opening a database another tab may hold", () => {
  it("resolves with the database when it opens in time", async () => {
    const { request, database, asRequest } = fakeRequest();
    const opened = openWithin(asRequest, "game", () => {});
    request.onsuccess?.();
    await expect(opened).resolves.toBe(database);
  });

  it("does not give up on blocked alone, since the other tab may be about to let go", async () => {
    const { request, database, asRequest } = fakeRequest();
    const opened = openWithin(asRequest, "game", () => {});
    request.onblocked?.();
    vi.advanceTimersByTime(3_999);
    request.onsuccess?.();
    await expect(opened).resolves.toBe(database);
  });

  it("says the data is held when nothing happens within the wait", async () => {
    const { asRequest } = fakeRequest();
    const opened = openWithin(asRequest, "games-list", () => {});
    vi.advanceTimersByTime(4_000);
    await expect(opened).rejects.toBeInstanceOf(StorageHeldElsewhereError);
    await expect(opened).rejects.toMatchObject({ scope: "games-list" });
  });

  it("closes a connection that arrives after it gave up", async () => {
    const { request, database, asRequest } = fakeRequest();
    const opened = openWithin(asRequest, "game", () => {});
    vi.advanceTimersByTime(4_000);
    await expect(opened).rejects.toBeInstanceOf(StorageHeldElsewhereError);
    request.onsuccess?.();
    expect(database.close).toHaveBeenCalledTimes(1);
  });

  it("stops waiting once the upgrade starts, and runs it", async () => {
    const { request, database, asRequest } = fakeRequest();
    const upgrade = vi.fn();
    const opened = openWithin(asRequest, "game", upgrade);
    vi.advanceTimersByTime(100);
    request.onupgradeneeded?.();
    vi.advanceTimersByTime(5_900);
    request.onsuccess?.();
    await expect(opened).resolves.toBe(database);
    expect(upgrade).toHaveBeenCalledWith(database);
  });

  it("rejects with the request's own error", async () => {
    const { request, asRequest } = fakeRequest();
    const failure = new Error("quota");
    request.error = failure;
    const opened = openWithin(asRequest, "game", () => {});
    request.onerror?.();
    await expect(opened).rejects.toBe(failure);
  });
});

describe("deleting a database another tab may hold", () => {
  it("resolves when the delete succeeds", async () => {
    const { request, asRequest } = fakeRequest();
    const deleted = deleteWithin(asRequest);
    request.onsuccess?.();
    await expect(deleted).resolves.toBeUndefined();
  });

  it("says the game is held when nothing happens within the wait", async () => {
    const { asRequest } = fakeRequest();
    const deleted = deleteWithin(asRequest);
    vi.advanceTimersByTime(4_000);
    await expect(deleted).rejects.toMatchObject({ scope: "game" });
  });
});

describe("why a tab was asked to let go", () => {
  it("is a delete when there is no new version, and an update otherwise", () => {
    expect(stopCauseOf(null)).toBe("other");
    expect(stopCauseOf(7)).toBe("update");
  });
});
