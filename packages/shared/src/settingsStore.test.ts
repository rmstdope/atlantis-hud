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
type DocumentStub = {
  documentElement: {
    dataset: Record<string, string>;
    /** Stands in for CSSStyleDeclaration: the store only ever calls `setProperty`. */
    style: {
      properties: Record<string, string>;
      setProperty: (name: string, value: string) => void;
    };
  };
};

function installDocumentStub(): DocumentStub {
  const properties: Record<string, string> = {};
  const stub: DocumentStub = {
    documentElement: {
      dataset: {},
      style: {
        properties,
        setProperty: (name, value) => {
          properties[name] = value;
        }
      }
    }
  };
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

  it("defaults the pane transparency to 90 percent", () => {
    expect(store().paneTransparency).toBe(90);
  });

  it("stamps the chosen pane transparency onto the document root", () => {
    const stub = installDocumentStub();

    store().setPaneTransparency(40);

    expect(store().paneTransparency).toBe(40);
    expect(stub.documentElement.style.properties["--pane-transparency"]).toBe("40");
  });

  /**
   * The slider only offers 0 to 95, but the store is also fed by whatever localStorage holds, and
   * a hand-edited or corrupted value must not paint the panes invisible or the setter throw.
   */
  it("clamps the transparency to what the slider offers, 0 to 95", () => {
    store().setPaneTransparency(150);
    expect(store().paneTransparency).toBe(95);

    store().setPaneTransparency(-10);
    expect(store().paneTransparency).toBe(0);

    // A fraction rounds rather than stamping a long decimal into the CSS.
    store().setPaneTransparency(33.4);
    expect(store().paneTransparency).toBe(33);
  });

  it("applies the persisted pane transparency at startup", () => {
    store().setPaneTransparency(20);
    const stub = installDocumentStub();

    applyPersistedSettings();

    expect(stub.documentElement.style.properties["--pane-transparency"]).toBe("20");
  });

  /**
   * Rehydration merges storage straight into state without the setter, so a hand-edited or
   * corrupt value would otherwise leave the label saying one thing and the panes painting
   * another. Startup must reconcile both sides, not just the CSS.
   */
  it("sanitizes a persisted transparency from outside the range, state and stamp alike", () => {
    useSettingsStore.setState({ paneTransparency: 150 });
    const stub = installDocumentStub();

    applyPersistedSettings();

    expect(store().paneTransparency).toBe(95);
    expect(stub.documentElement.style.properties["--pane-transparency"]).toBe("95");
  });

  it("reads a persisted transparency that storage kept as a string", () => {
    // JSON round-trips preserve numbers, but storage is hand-editable and other writers exist.
    useSettingsStore.setState({ paneTransparency: "40" as unknown as number });
    const stub = installDocumentStub();

    applyPersistedSettings();

    expect(store().paneTransparency).toBe(40);
    expect(stub.documentElement.style.properties["--pane-transparency"]).toBe("40");
  });

  it("defaults the unit list limit to zero, meaning every unit is shown", () => {
    expect(store().unitListLimit).toBe(0);
  });

  it("clamps the unit list limit to a whole, non-negative count", () => {
    store().setUnitListLimit(-5);
    expect(store().unitListLimit).toBe(0);

    // A fraction rounds rather than leaving a decimal no row count can honour.
    store().setUnitListLimit(12.6);
    expect(store().unitListLimit).toBe(13);
  });

  it("persists the unit list limit", async () => {
    store().setUnitListLimit(25);
    expect(store().unitListLimit).toBe(25);

    const storage = useSettingsStore.persist.getOptions().storage;
    const persisted = await storage?.getItem("atlantis-hud-settings");
    if (!storage || !persisted) {
      throw new Error("settings storage was not available");
    }

    useSettingsStore.setState({ unitListLimit: 0 });
    await storage.setItem("atlantis-hud-settings", persisted);
    await useSettingsStore.persist.rehydrate();

    expect(store().unitListLimit).toBe(25);
  });

  it("sanitizes a persisted unit list limit, garbage falling back to showing all", () => {
    useSettingsStore.setState({ unitListLimit: "not a number" as unknown as number });

    applyPersistedSettings();

    expect(store().unitListLimit).toBe(0);
  });

  it("reads a persisted unit list limit that storage kept as a string", () => {
    useSettingsStore.setState({ unitListLimit: "25" as unknown as number });

    applyPersistedSettings();

    expect(store().unitListLimit).toBe(25);
  });

  it("resets the unit list limit to its default", () => {
    store().setUnitListLimit(10);

    resetSettingsStore();

    expect(store().unitListLimit).toBe(0);
  });

  it("resets the pane transparency to its default", () => {
    const stub = installDocumentStub();
    store().setPaneTransparency(10);

    resetSettingsStore();

    expect(store().paneTransparency).toBe(90);
    expect(stub.documentElement.style.properties["--pane-transparency"]).toBe("90");
  });
});
