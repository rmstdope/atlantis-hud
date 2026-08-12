import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyPersistedSettings,
  resetSettingsStore,
  useSettingsStore
} from "./settingsStore";
import { DEFAULT_MAP_THEME_ID, MAP_THEMES } from "./workspace/mapThemes";

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

  /**
   * Off by default, and that is the whole point of it being a setting. Most hexes are deliberately
   * left unguarded, so this check speaks about hex after hex - measured against the committed turn
   * 71, one warning for every hex the faction stands in. Losing a guard you had is reported either
   * way, because that is a change the player may not have meant.
   */
  it("leaves the unguarded-hex warning off until it is asked for", () => {
    expect(store().warnOnUnguardedHex).toBe(false);

    store().setWarnOnUnguardedHex(true);
    expect(store().warnOnUnguardedHex).toBe(true);
  });

  it("persists the unguarded-hex preference", async () => {
    store().setWarnOnUnguardedHex(true);

    const storage = useSettingsStore.persist.getOptions().storage;
    const persisted = await storage?.getItem("atlantis-hud-settings");
    if (!storage || !persisted) {
      throw new Error("settings storage was not available");
    }

    useSettingsStore.setState({ warnOnUnguardedHex: false });
    await storage.setItem("atlantis-hud-settings", persisted);
    await useSettingsStore.persist.rehydrate();

    expect(store().warnOnUnguardedHex).toBe(true);
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

  it("defaults the unit list limit to twelve rows", () => {
    expect(store().unitListLimit).toBe(12);
  });

  it("clamps the unit list limit to what the slider offers, 3 to 16", () => {
    store().setUnitListLimit(150);
    expect(store().unitListLimit).toBe(16);

    store().setUnitListLimit(1);
    expect(store().unitListLimit).toBe(3);

    // A fraction rounds rather than leaving a decimal no row count can honour.
    store().setUnitListLimit(12.6);
    expect(store().unitListLimit).toBe(13);
  });

  it("persists the unit list limit", async () => {
    store().setUnitListLimit(15);
    expect(store().unitListLimit).toBe(15);

    const storage = useSettingsStore.persist.getOptions().storage;
    const persisted = await storage?.getItem("atlantis-hud-settings");
    if (!storage || !persisted) {
      throw new Error("settings storage was not available");
    }

    useSettingsStore.setState({ unitListLimit: 12 });
    await storage.setItem("atlantis-hud-settings", persisted);
    await useSettingsStore.persist.rehydrate();

    expect(store().unitListLimit).toBe(15);
  });

  /**
   * The earlier build persisted 0 as "show all", and it was the default - so it is what every
   * untouched settings blob holds. Clamping it to the floor would greet the whole existing user
   * base with the tightest cap; it means "no preference" and becomes the default instead.
   */
  it("migrates the earlier build's show-all zero to the default rather than the floor", () => {
    useSettingsStore.setState({ unitListLimit: 0 });

    applyPersistedSettings();

    expect(store().unitListLimit).toBe(12);
  });

  it("sanitizes a persisted unit list limit, garbage falling back to the default", () => {
    useSettingsStore.setState({ unitListLimit: "not a number" as unknown as number });

    applyPersistedSettings();

    expect(store().unitListLimit).toBe(12);
  });

  it("reads a persisted unit list limit that storage kept as a string", () => {
    useSettingsStore.setState({ unitListLimit: "14" as unknown as number });

    applyPersistedSettings();

    expect(store().unitListLimit).toBe(14);
  });

  it("keeps the movement planner behind its flag, off by default", () => {
    expect(store().movementPlanner).toBe(false);
  });

  it("persists the movement planner flag", async () => {
    store().setMovementPlanner(true);
    expect(store().movementPlanner).toBe(true);

    const storage = useSettingsStore.persist.getOptions().storage;
    const persisted = await storage?.getItem("atlantis-hud-settings");
    if (!storage || !persisted) {
      throw new Error("settings storage was not available");
    }

    useSettingsStore.setState({ movementPlanner: false });
    await storage.setItem("atlantis-hud-settings", persisted);
    await useSettingsStore.persist.rehydrate();

    expect(store().movementPlanner).toBe(true);
  });

  it("resets the movement planner flag to off", () => {
    store().setMovementPlanner(true);

    resetSettingsStore();

    expect(store().movementPlanner).toBe(false);
  });

  it("resets the unit list limit to its default", () => {
    store().setUnitListLimit(16);

    resetSettingsStore();

    expect(store().unitListLimit).toBe(12);
  });

  it("resets the pane transparency to its default", () => {
    const stub = installDocumentStub();
    store().setPaneTransparency(10);

    resetSettingsStore();

    expect(store().paneTransparency).toBe(90);
    expect(stub.documentElement.style.properties["--pane-transparency"]).toBe("90");
  });

  it("starts with no snippets", () => {
    expect(store().snippets).toEqual([]);
  });

  it("adds, edits and removes snippets", () => {
    store().addSnippet({ id: "s1", name: "patrol", body: "MOVE ${dir}\nGUARD 1" });
    store().addSnippet({ id: "s2", name: "taxes", body: "@tax" });
    expect(store().snippets.map((snippet) => snippet.name)).toEqual(["patrol", "taxes"]);

    store().updateSnippet("s1", { name: "scout", body: "MOVE ${dir}" });
    expect(store().snippets[0]).toEqual({ id: "s1", name: "scout", body: "MOVE ${dir}" });

    store().removeSnippet("s2");
    expect(store().snippets.map((snippet) => snippet.id)).toEqual(["s1"]);
  });

  it("persists snippets", async () => {
    store().addSnippet({ id: "s1", name: "patrol", body: "@work" });

    const storage = useSettingsStore.persist.getOptions().storage;
    const persisted = await storage?.getItem("atlantis-hud-settings");
    if (!storage || !persisted) {
      throw new Error("settings storage was not available");
    }

    useSettingsStore.setState({ snippets: [] });
    await storage.setItem("atlantis-hud-settings", persisted);
    await useSettingsStore.persist.rehydrate();

    expect(store().snippets).toEqual([{ id: "s1", name: "patrol", body: "@work" }]);
  });

  it("drops malformed snippets from storage instead of breaking on them", () => {
    // Rehydration merges storage straight into state without any setter, and storage is
    // hand-editable - the same door every other persisted setting guards at startup.
    useSettingsStore.setState({
      snippets: [
        { id: "ok", name: "patrol", body: "@work" },
        { id: 9, name: "bad", body: "@tax" },
        "garbage"
      ] as never
    });

    applyPersistedSettings();

    expect(store().snippets).toEqual([{ id: "ok", name: "patrol", body: "@work" }]);
  });

  it("resets snippets with everything else", () => {
    store().addSnippet({ id: "s1", name: "patrol", body: "@work" });

    resetSettingsStore();

    expect(store().snippets).toEqual([]);
  });

  /**
   * The shortcuts overlay is the one thing in the application that cannot be found by exploring:
   * it is opened by a key, and a player who does not know the keys is exactly who needs it. So it
   * shows itself, until told not to.
   */
  it("offers the shortcuts overlay at startup until told otherwise", () => {
    expect(store().showShortcutsAtStartup).toBe(true);
  });

  it("remembers being told not to show it", async () => {
    store().setShowShortcutsAtStartup(false);
    expect(store().showShortcutsAtStartup).toBe(false);

    const storage = useSettingsStore.persist.getOptions().storage;
    const persisted = await storage?.getItem("atlantis-hud-settings");
    if (!storage || !persisted) {
      throw new Error("settings storage was not available");
    }

    useSettingsStore.setState({ showShortcutsAtStartup: true });
    await storage.setItem("atlantis-hud-settings", persisted);
    await useSettingsStore.persist.rehydrate();

    expect(store().showShortcutsAtStartup).toBe(false);
  });

  /**
   * Every settings blob written before this existed has no such key, and rehydration merges
   * storage over the defaults rather than beside them. Those players are precisely the ones who
   * have never been shown the overlay, so the absent key has to mean "show it".
   */
  it("shows it to a player upgrading from a build that had no such setting", async () => {
    // A value no default could produce, which also gives storage a blob to edit.
    store().setPaneTransparency(35);

    const storage = useSettingsStore.persist.getOptions().storage;
    const persisted = (await storage?.getItem("atlantis-hud-settings")) as
      | { state: Record<string, unknown>; version?: number }
      | undefined;
    if (!storage || !persisted) {
      throw new Error("settings storage was not available");
    }

    // The blob an older build wrote: everything else, and no mention of this key at all.
    const olderState = { ...persisted.state };
    delete olderState.showShortcutsAtStartup;
    // Reset first, so the store is at its defaults exactly as it is when the application starts,
    // and the blob is written after that because resetting also clears storage.
    resetSettingsStore();
    // Cast because the point of the blob is that it is *not* the current shape: the key this test
    // is about is missing from it, which is exactly what an older build wrote.
    await storage.setItem("atlantis-hud-settings", {
      ...persisted,
      state: olderState
    } as unknown as Parameters<typeof storage.setItem>[1]);
    await useSettingsStore.persist.rehydrate();

    // The transparency is the control: it proves the older blob was read at all, so the answer
    // below is the absent key being answered rather than storage being ignored.
    expect(store().paneTransparency).toBe(35);
    expect(store().showShortcutsAtStartup).toBe(true);
  });

  it("resets the startup preference with everything else", () => {
    store().setShowShortcutsAtStartup(false);

    resetSettingsStore();

    expect(store().showShortcutsAtStartup).toBe(true);
  });
});

/**
 * Which of the map's hex renderings the world map draws with. Global rather than per game: it is a
 * statement about how this player likes to read a map, not about one campaign.
 */
describe("the map theme", () => {
  beforeEach(() => {
    removeDocumentStub();
    resetSettingsStore();
  });
  afterEach(removeDocumentStub);

  it("opens on Classic, which is the map as it has always looked", () => {
    expect(store().mapTheme).toBe(DEFAULT_MAP_THEME_ID);
  });

  it("changes to any theme the registry ships", () => {
    for (const theme of MAP_THEMES) {
      store().setMapTheme(theme.id);
      expect(store().mapTheme).toBe(theme.id);
    }
  });

  it("refuses a theme nothing can draw, keeping the map rather than blanking it", () => {
    store().setMapTheme("no-such-theme");

    expect(store().mapTheme).toBe(DEFAULT_MAP_THEME_ID);
  });

  /**
   * Asserted against the written blob rather than by setting a theme and reading it back.
   *
   * Only one theme ships so far, and it is also the default - so a round trip could only ever
   * compare the default with itself, and would pass just as happily if the setting were missing
   * from `partialize` altogether and never written at all. What has to be true is that the key
   * reaches storage; that is what a restart reads.
   */
  it("writes the chosen theme to storage, which is what survives a restart", async () => {
    store().setMapTheme(DEFAULT_MAP_THEME_ID);

    const storage = useSettingsStore.persist.getOptions().storage;
    const persisted = await storage?.getItem("atlantis-hud-settings");
    if (!persisted) {
      throw new Error("settings storage was not available");
    }

    expect(persisted.state.mapTheme).toBe(DEFAULT_MAP_THEME_ID);
  });

  it("restores the theme storage names, rather than the default", async () => {
    // Written straight into the blob, because the id has to be one the setter would accept and
    // there is only one of those today. Rehydration is the path a restart actually takes.
    const storage = useSettingsStore.persist.getOptions().storage;
    const persisted = await storage?.getItem("atlantis-hud-settings");
    if (!storage || !persisted) {
      throw new Error("settings storage was not available");
    }
    const theme = MAP_THEMES.at(-1)?.id ?? DEFAULT_MAP_THEME_ID;

    await storage.setItem("atlantis-hud-settings", {
      ...persisted,
      state: { ...persisted.state, mapTheme: theme, paneTransparency: 35 }
    });
    await useSettingsStore.persist.rehydrate();

    // The transparency rides along as a control: it proves the blob was read at all, using a value
    // no default could have produced.
    expect(store().paneTransparency).toBe(35);
    expect(store().mapTheme).toBe(theme);
  });

  it("falls back at startup when storage names a theme this build has never had", () => {
    // Rehydration merges storage straight into state without the setter, and a build can be
    // downgraded past a theme it once shipped. Reconciled here, as every other setting is.
    useSettingsStore.setState({ mapTheme: "removed-in-a-later-build" });

    applyPersistedSettings();

    expect(store().mapTheme).toBe(DEFAULT_MAP_THEME_ID);
  });

  it("resets with everything else", () => {
    const theme = MAP_THEMES.at(-1);
    store().setMapTheme(theme?.id ?? DEFAULT_MAP_THEME_ID);

    resetSettingsStore();

    expect(store().mapTheme).toBe(DEFAULT_MAP_THEME_ID);
  });
});
