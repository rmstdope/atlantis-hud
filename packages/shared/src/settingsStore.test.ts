import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyPersistedSettings,
  resetSettingsStore,
  useSettingsStore
} from "./settingsStore";

const store = () => useSettingsStore.getState();

/**
 * These tests run under Node, where no `document` exists. A minimal stand-in with just
 * `documentElement.dataset` is enough to observe the theme attribute the store applies; it is
 * removed again so other suites see the environment they expect.
 */
type DocumentStub = { documentElement: { dataset: Record<string, string> } };

function installDocumentStub(): DocumentStub {
  const stub: DocumentStub = { documentElement: { dataset: {} } };
  (globalThis as { document?: unknown }).document = stub;
  return stub;
}

function removeDocumentStub() {
  delete (globalThis as { document?: unknown }).document;
}

describe("settings store", () => {
  beforeEach(() => {
    removeDocumentStub();
    resetSettingsStore();
  });
  afterEach(removeDocumentStub);

  it("defaults to the dark theme", () => {
    expect(store().theme).toBe("dark");
  });

  it("enables biome textures by default", () => {
    expect(store().biomeTextures).toBe(true);
  });

  it("switches the theme instantly when set", () => {
    store().setTheme("light");
    expect(store().theme).toBe("light");

    store().setTheme("dark");
    expect(store().theme).toBe("dark");
  });

  it("persists the biome texture preference", async () => {
    store().setBiomeTextures(false);
    expect(store().biomeTextures).toBe(false);

    const storage = useSettingsStore.persist.getOptions().storage;
    const persisted = await storage?.getItem("atlantis-hud-settings");
    if (!storage || !persisted) {
      throw new Error("settings storage was not available");
    }

    useSettingsStore.setState({ biomeTextures: true });
    await storage.setItem("atlantis-hud-settings", persisted);
    await useSettingsStore.persist.rehydrate();

    expect(store().biomeTextures).toBe(false);
  });

  it("stamps the chosen theme onto the document root", () => {
    const stub = installDocumentStub();

    store().setTheme("light");
    expect(stub.documentElement.dataset.theme).toBe("light");

    store().setTheme("dark");
    expect(stub.documentElement.dataset.theme).toBe("dark");
  });

  it("survives without a document, as under Node and in tests", () => {
    expect(() => store().setTheme("light")).not.toThrow();
    expect(store().theme).toBe("light");
  });

  it("applies the persisted theme at startup", () => {
    // Startup runs before React mounts: main.tsx calls this once so a light-theme user never
    // sees a dark flash. The store rehydrates synchronously from storage, so the value read
    // here is the persisted one.
    store().setTheme("light");
    const stub = installDocumentStub();

    applyPersistedSettings();

    expect(stub.documentElement.dataset.theme).toBe("light");
  });

  it("resets to dark, document stamp included", () => {
    const stub = installDocumentStub();
    store().setTheme("light");

    resetSettingsStore();

    expect(store().theme).toBe("dark");
    expect(stub.documentElement.dataset.theme).toBe("dark");
  });
});
