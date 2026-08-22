import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ADVISORY_CHECK_CODES } from "@atlantis/core-client";
import {
  applyPersistedSettings,
  DEFAULT_ADVISORY_CHECKS,
  resetSettingsStore,
  useSettingsStore
} from "./settingsStore";
import type { ThemeName } from "./settingsStore";
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
   * 71, one warning for every hex the faction stands in. Every other advisory check starts on: it
   * is narrow enough to be useful from the first turn.
   */
  it("advisory checks default to on, except the unguarded-hex one", () => {
    expect(store().advisoryChecks["hex-unguarded"]).toBe(false);
    for (const code of ADVISORY_CHECK_CODES) {
      if (code === "hex-unguarded") {
        continue;
      }
      expect(store().advisoryChecks[code]).toBe(true);
    }
  });

  it("persists a toggled advisory check", async () => {
    store().setAdvisoryCheck("hex-unguarded", true);
    store().setAdvisoryCheck("not-enough-silver", false);
    expect(store().advisoryChecks["hex-unguarded"]).toBe(true);
    expect(store().advisoryChecks["not-enough-silver"]).toBe(false);

    const storage = useSettingsStore.persist.getOptions().storage;
    const persisted = await storage?.getItem("atlantis-hud-settings");
    if (!storage || !persisted) {
      throw new Error("settings storage was not available");
    }

    useSettingsStore.setState({ advisoryChecks: DEFAULT_ADVISORY_CHECKS });
    await storage.setItem("atlantis-hud-settings", persisted);
    await useSettingsStore.persist.rehydrate();

    expect(store().advisoryChecks["hex-unguarded"]).toBe(true);
    expect(store().advisoryChecks["not-enough-silver"]).toBe(false);
  });

  it("persists the Order OCD preference", async () => {
    expect(store().orderOcd).toBe(false);
    store().setOrderOcd(true);
    expect(store().orderOcd).toBe(true);

    const storage = useSettingsStore.persist.getOptions().storage;
    const persisted = await storage?.getItem("atlantis-hud-settings");
    if (!storage || !persisted) {
      throw new Error("settings storage was not available");
    }

    useSettingsStore.setState({ orderOcd: false });
    await storage.setItem("atlantis-hud-settings", persisted);
    await useSettingsStore.persist.rehydrate();

    expect(store().orderOcd).toBe(true);
  });

  it("counts upkeep by default, and persists the preference", async () => {
    expect(store().countUpkeep).toBe(true);
    store().setCountUpkeep(false);
    expect(store().countUpkeep).toBe(false);

    const storage = useSettingsStore.persist.getOptions().storage;
    const persisted = await storage?.getItem("atlantis-hud-settings");
    if (!storage || !persisted) {
      throw new Error("settings storage was not available");
    }

    useSettingsStore.setState({ countUpkeep: true });
    await storage.setItem("atlantis-hud-settings", persisted);
    await useSettingsStore.persist.rehydrate();

    expect(store().countUpkeep).toBe(false);
  });

  it("reconciles garbage advisory values to the defaults", () => {
    useSettingsStore.setState({
      advisoryChecks: {
        "hex-unguarded": "yes",
        "guard-dropped": false
      } as unknown as typeof DEFAULT_ADVISORY_CHECKS
    });

    applyPersistedSettings();

    expect(store().advisoryChecks).toEqual({
      ...DEFAULT_ADVISORY_CHECKS,
      // A real boolean, differing from the default, survives reconciliation untouched.
      "guard-dropped": false
    });
  });

  /**
   * The earlier build had one checkbox, "Warn about unguarded hexes", persisted under its own key.
   * A player who ticked it upgrading into the Warnings tab must keep seeing that warning - applying
   * the new default instead would silently flip a preference they chose.
   */
  it("migrates the old unguarded-hex preference into the record", async () => {
    const storage = useSettingsStore.persist.getOptions().storage;
    const persisted = (await storage?.getItem("atlantis-hud-settings")) as
      | { state: Record<string, unknown>; version?: number }
      | undefined;
    if (!storage || !persisted) {
      throw new Error("settings storage was not available");
    }

    // The blob an older build wrote: the old key, and no mention of advisoryChecks at all.
    const olderState = { ...persisted.state };
    delete olderState.advisoryChecks;
    olderState.warnOnUnguardedHex = true;
    resetSettingsStore();
    await storage.setItem("atlantis-hud-settings", {
      ...persisted,
      state: olderState
    } as unknown as Parameters<typeof storage.setItem>[1]);
    await useSettingsStore.persist.rehydrate();
    applyPersistedSettings();

    expect(store().advisoryChecks["hex-unguarded"]).toBe(true);
    // Nothing else in the record should have moved.
    expect(store().advisoryChecks["not-enough-silver"]).toBe(true);
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

  it("defaults the pane transparency to 20 percent", () => {
    // 20, not 90 (ah-v09e): at 90 the panes were painted at 10% opacity and the app's text sat on
    // live terrain, below AA over most of the map. theme.css's `--pane-transparency` fallback
    // must carry the same number, or the first frame paints differently from every one after it.
    expect(store().paneTransparency.dark).toBe(20);
  });

  it("stamps the chosen pane transparency onto the document root", () => {
    const stub = installDocumentStub();

    store().setPaneTransparency(40);

    expect(store().paneTransparency.dark).toBe(40);
    expect(stub.documentElement.style.properties["--pane-transparency"]).toBe("40");
  });

  /**
   * Light mode cannot afford see-through panes: dark ink over a light pane over the map fails AA
   * across the terrain sweep, so light defaults to opaque while dark stays at 20 (ah-j1xd). One
   * number could not express that, so each theme remembers its own.
   */
  it("keeps the pane transparency per theme", () => {
    store().setPaneTransparency(40);
    expect(store().paneTransparency.dark).toBe(40);
    expect(store().paneTransparency.light).toBe(0);

    store().setTheme("light");
    store().setPaneTransparency(15);
    expect(store().paneTransparency.light).toBe(15);
    expect(store().paneTransparency.dark).toBe(40);

    store().setTheme("dark");
    expect(store().paneTransparency.dark).toBe(40);
  });

  /**
   * The easiest thing here to miss: nothing re-stamped `--pane-transparency` on a theme change,
   * because there used to be one value for both themes. Without this the panes stay painted at
   * the other theme's value until something else happens to stamp, which reads as the setting
   * being ignored at random.
   */
  it("repaints the panes when the theme changes", () => {
    const stub = installDocumentStub();

    store().setPaneTransparency(40);
    expect(stub.documentElement.style.properties["--pane-transparency"]).toBe("40");

    store().setTheme("light");
    expect(stub.documentElement.style.properties["--pane-transparency"]).toBe("0");

    store().setTheme("dark");
    expect(stub.documentElement.style.properties["--pane-transparency"]).toBe("40");
  });

  /**
   * The slider only offers 0 to 95, but the store is also fed by whatever localStorage holds, and
   * a hand-edited or corrupted value must not paint the panes invisible or the setter throw.
   */
  it("clamps the transparency to what the slider offers, 0 to 95", () => {
    store().setPaneTransparency(150);
    expect(store().paneTransparency.dark).toBe(95);

    store().setPaneTransparency(-10);
    expect(store().paneTransparency.dark).toBe(0);

    // A fraction rounds rather than stamping a long decimal into the CSS.
    store().setPaneTransparency(33.4);
    expect(store().paneTransparency.dark).toBe(33);
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
    useSettingsStore.setState({ paneTransparency: { dark: 150, light: 0 } });
    const stub = installDocumentStub();

    applyPersistedSettings();

    expect(store().paneTransparency.dark).toBe(95);
    expect(stub.documentElement.style.properties["--pane-transparency"]).toBe("95");
  });

  it("reads a persisted transparency that storage kept as a string", () => {
    // JSON round-trips preserve numbers, but storage is hand-editable and other writers exist.
    useSettingsStore.setState({
      paneTransparency: { dark: "40", light: 0 } as unknown as Record<ThemeName, number>
    });
    const stub = installDocumentStub();

    applyPersistedSettings();

    expect(store().paneTransparency.dark).toBe(40);
    expect(stub.documentElement.style.properties["--pane-transparency"]).toBe("40");
  });

  /**
   * Before ah-j1xd this was a single number shared by both themes, and it is persisted - so every
   * existing profile has a number where the code now wants a record. Left unreconciled,
   * `paneTransparency[theme]` is `undefined`, `String(undefined)` reaches the custom property and
   * `.bg-pane`'s calc() produces nothing at all: panes with no background. A fresh profile never
   * hits it, which is why only this test can.
   */
  it("keeps a stored transparency number as the dark theme's value", () => {
    useSettingsStore.setState({ paneTransparency: 65 as unknown as Record<ThemeName, number> });

    applyPersistedSettings();

    expect(store().paneTransparency).toEqual({ dark: 65, light: 0 });
  });

  it("coerces a stored transparency number that storage kept as a string", () => {
    useSettingsStore.setState({ paneTransparency: "65" as unknown as Record<ThemeName, number> });

    applyPersistedSettings();

    expect(store().paneTransparency).toEqual({ dark: 65, light: 0 });
  });

  it("falls back to each theme's own default when its stored value is unreadable", () => {
    // Not one shared fallback: an unreadable light value must land on light's default of 0, or a
    // corrupt blob would quietly put a light user back on see-through panes below AA.
    useSettingsStore.setState({
      paneTransparency: { dark: "nonsense", light: "nonsense" } as unknown as Record<
        ThemeName,
        number
      >
    });

    applyPersistedSettings();

    expect(store().paneTransparency).toEqual({ dark: 20, light: 0 });
  });

  it("completes a half-written transparency record from the defaults", () => {
    useSettingsStore.setState({ paneTransparency: { dark: 40 } as Record<ThemeName, number> });

    applyPersistedSettings();

    expect(store().paneTransparency).toEqual({ dark: 40, light: 0 });
  });

  it.each([[null], [[]], ["x"], [true]])(
    "falls back to both defaults when the stored transparency is %s",
    (stored) => {
      useSettingsStore.setState({ paneTransparency: stored as unknown as Record<ThemeName, number> });

      applyPersistedSettings();

      expect(store().paneTransparency).toEqual({ dark: 20, light: 0 });
    }
  );

  it("defaults the interface size to 100 percent", () => {
    expect(store().interfaceSize).toBe(100);
  });

  it("stamps the chosen interface size onto the document root as a multiplier", () => {
    const stub = installDocumentStub();

    store().setInterfaceSize(150);

    expect(store().interfaceSize).toBe(150);
    expect(stub.documentElement.style.properties["--ui-scale"]).toBe("1.5");
  });

  /**
   * The slider only offers steps of 25 between 100 and 200, but the store is also fed by whatever
   * localStorage holds, and a hand-edited or corrupted value must land on a real step rather than
   * throw or leave the slider between its stops.
   */
  it("clamps the interface size to a 25-percent step between 100 and 200", () => {
    store().setInterfaceSize(137);
    expect(store().interfaceSize).toBe(125);

    store().setInterfaceSize(500);
    expect(store().interfaceSize).toBe(200);

    store().setInterfaceSize(50);
    expect(store().interfaceSize).toBe(100);

    // A garbage value falls back to the default rather than to an extreme.
    store().setInterfaceSize(Number.NaN);
    expect(store().interfaceSize).toBe(100);
  });

  it("applies the persisted interface size at startup", () => {
    store().setInterfaceSize(150);
    const stub = installDocumentStub();

    applyPersistedSettings();

    expect(stub.documentElement.style.properties["--ui-scale"]).toBe("1.5");
  });

  /**
   * Rehydration merges storage straight into state without the setter, so a hand-edited or
   * out-of-range value would otherwise leave the slider saying one thing and the panes rendering
   * another. Startup must reconcile both sides, exactly as it does for pane transparency.
   */
  it("sanitizes a persisted interface size from outside the range, state and stamp alike", () => {
    useSettingsStore.setState({ interfaceSize: 999 });
    const stub = installDocumentStub();

    applyPersistedSettings();

    expect(store().interfaceSize).toBe(200);
    expect(stub.documentElement.style.properties["--ui-scale"]).toBe("2");
  });

  /**
   * The retired units-pane keys (`unitListLimit`, `unitListFixedSize` - ah-2r3, removed with the
   * pane's row-count setting) must not survive a settings blob written before this build. Storage
   * is hand-editable and other writers exist, and `partialize` no longer lists them, so the very
   * next save drops them - proving neither key is read nor re-written by anything left standing.
   */
  it("drops the retired units-pane keys from storage on the next save", async () => {
    const storage = useSettingsStore.persist.getOptions().storage;
    if (!storage) {
      throw new Error("settings storage was not available");
    }
    await storage.setItem("atlantis-hud-settings", {
      state: { unitListLimit: 6, unitListFixedSize: true, paneTransparency: 35 },
      version: 0
    } as unknown as Parameters<typeof storage.setItem>[1]);
    await useSettingsStore.persist.rehydrate();

    // The control: it proves the seeded blob was actually read, so the assertion below is about
    // the retired keys being dropped rather than storage being ignored altogether.
    expect(store().paneTransparency).toBe(35);

    store().setPaneTransparency(40);

    const persisted = (await storage.getItem("atlantis-hud-settings")) as
      | { state: Record<string, unknown> }
      | undefined;
    expect(persisted?.state).not.toHaveProperty("unitListLimit");
    expect(persisted?.state).not.toHaveProperty("unitListFixedSize");
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

  it("resets the pane transparency to its default", () => {
    const stub = installDocumentStub();
    store().setPaneTransparency(10);

    resetSettingsStore();

    expect(store().paneTransparency).toEqual({ dark: 20, light: 0 });
    expect(stub.documentElement.style.properties["--pane-transparency"]).toBe("20");
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
    expect(store().paneTransparency.dark).toBe(35);
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

  it("opens on the registry's default", () => {
    expect(store().mapTheme).toBe(DEFAULT_MAP_THEME_ID);
  });

  /**
   * Classic shipped as the default for as long as it existed, so "classic" is what sits in the
   * settings blob of every player who never opened the picker. No migration code was written for
   * it - `knownMapTheme` already answers the default for an id the registry does not know - and
   * that is precisely why it is pinned here rather than assumed: the whole existing user base
   * comes back through this path. The map itself would survive without it, since the shell
   * resolves the id through `getMapTheme` on every render and that falls back too; what the
   * reconciliation fixes is the id the store holds and the picker shows.
   *
   * Driven through storage and the startup call rather than through `setState`, because those are
   * the two doors a returning player actually comes in by: rehydration merges the blob into state
   * without ever reaching the setter, and `applyPersistedSettings` is the only thing that then
   * reconciles it.
   */
  it("moves a settings blob that still names Classic onto the default", async () => {
    const storage = useSettingsStore.persist.getOptions().storage;
    store().setMapTheme(DEFAULT_MAP_THEME_ID);
    const persisted = await storage?.getItem("atlantis-hud-settings");
    if (!storage || !persisted) {
      throw new Error("settings storage was not available");
    }

    const retired = JSON.parse(JSON.stringify(persisted)) as typeof persisted;
    retired.state.mapTheme = "classic";
    await storage.setItem("atlantis-hud-settings", retired);
    await useSettingsStore.persist.rehydrate();
    // The blob really did carry it in: without the reconciliation below, this is what the map
    // would have been asked to draw with.
    expect(store().mapTheme).toBe("classic");

    applyPersistedSettings();

    expect(store().mapTheme).toBe(DEFAULT_MAP_THEME_ID);
    expect(store().mapTheme).not.toBe("classic");
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
      state: { ...persisted.state, mapTheme: theme, paneTransparency: { dark: 35, light: 0 } }
    });
    await useSettingsStore.persist.rehydrate();

    // The transparency rides along as a control: it proves the blob was read at all, using a value
    // no default could have produced.
    expect(store().paneTransparency.dark).toBe(35);
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
