import { describe, expect, it, vi } from "vitest";
import { requestPersistentStorage } from "./persistentStorage";

/** The two calls this depends on, with whatever answers a test wants from them. */
const storageThat = (answers: {
  persisted?: boolean | (() => Promise<boolean>);
  persist?: boolean | (() => Promise<boolean>);
}): StorageManager => {
  const resolve = (answer: boolean | (() => Promise<boolean>) | undefined) =>
    typeof answer === "function" ? answer : () => Promise.resolve(answer ?? false);

  return {
    persisted: vi.fn(resolve(answers.persisted)),
    persist: vi.fn(resolve(answers.persist))
  } as unknown as StorageManager;
};

describe("requestPersistentStorage", () => {
  it("asks, and reports being granted", async () => {
    const storage = storageThat({ persisted: false, persist: true });

    await expect(requestPersistentStorage(storage)).resolves.toBe("persisted");
    expect(storage.persist).toHaveBeenCalled();
  });

  it("reports a refusal as an outcome rather than a failure", async () => {
    // Browsers decide this by their own heuristics and a refusal is ordinary. The application is
    // no worse off than before it asked, so this must not read as an error.
    await expect(requestPersistentStorage(storageThat({ persist: false }))).resolves.toBe("denied");
  });

  it("does not ask again when the answer is already yes", async () => {
    const storage = storageThat({ persisted: true });

    await expect(requestPersistentStorage(storage)).resolves.toBe("persisted");
    expect(storage.persist).not.toHaveBeenCalled();
  });

  it("reports a browser without the API as unsupported", async () => {
    await expect(requestPersistentStorage(undefined)).resolves.toBe("unsupported");
    await expect(requestPersistentStorage({} as StorageManager)).resolves.toBe("unsupported");
  });

  it("survives an implementation that throws", async () => {
    // Safari has historically rejected here rather than resolving false, and a startup path that
    // dies because storage would not answer a question is worse than one that carries on unasked.
    const storage = storageThat({
      persisted: () => Promise.reject(new Error("denied by policy"))
    });

    await expect(requestPersistentStorage(storage)).resolves.toBe("unsupported");
  });
});
