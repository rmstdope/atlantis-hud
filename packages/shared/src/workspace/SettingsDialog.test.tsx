import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { ADVISORY_CHECK_CODES } from "@atlantis/core-client";
import { resetSettingsStore, useSettingsStore } from "../settingsStore";
import { restoreStoresForTest, setStoreStateForTest } from "../testing/storeState";
import { GlobalSettings, WarningSettings } from "./SettingsDialog";

/**
 * `renderToStaticMarkup` runs with no `window`, so React's server branch reads the store's
 * `getInitialState()` rather than `getState()` - see `../testing/storeState.ts`, which is the one
 * place that trap is explained and worked around.
 */

/** The markup of one testid's tag, so an assertion about it cannot match a sibling's attribute. */
function tag(html: string, testid: string): string {
  const match = html.match(new RegExp(`<[^>]*data-testid="${testid}"[^>]*>`));
  if (!match) {
    throw new Error(`no element carries data-testid="${testid}"`);
  }
  return match[0];
}

describe("the pane transparency setting", () => {
  afterEach(() => {
    restoreStoresForTest();
    resetSettingsStore();
  });

  it("shows the active theme's own value", () => {
    resetSettingsStore();
    setStoreStateForTest(useSettingsStore, {
      theme: "light",
      paneTransparency: { dark: 40, light: 15 }
    });

    const slider = tag(renderToStaticMarkup(<GlobalSettings />), "pane-transparency");

    expect(slider).toContain('value="15"');
  });

  it("shows the dark value again when dark is the active theme", () => {
    resetSettingsStore();
    setStoreStateForTest(useSettingsStore, {
      theme: "dark",
      paneTransparency: { dark: 40, light: 15 }
    });

    const slider = tag(renderToStaticMarkup(<GlobalSettings />), "pane-transparency");

    expect(slider).toContain('value="40"');
  });

  it("says in its hint that each theme is remembered separately", () => {
    resetSettingsStore();
    const html = renderToStaticMarkup(<GlobalSettings />);

    expect(html).toContain(
      "Makes the panes see-through so the map shows behind them. Remembered separately for the dark and light themes."
    );
  });
});

describe("the Interface size setting", () => {
  afterEach(() => {
    restoreStoresForTest();
    resetSettingsStore();
  });

  it("renders the slider at its default with the map-unaffected hint", () => {
    resetSettingsStore();
    const html = renderToStaticMarkup(<GlobalSettings />);

    const slider = tag(html, "settings-interface-size");
    expect(slider).toContain('min="100"');
    expect(slider).toContain('max="200"');
    expect(slider).toContain('step="25"');
    expect(slider).toContain('value="100"');
    expect(html).toContain("Makes the panes, the header and the dialogs bigger. The map is not affected.");
  });

  it("reflects a changed interface size", () => {
    useSettingsStore.getState().setInterfaceSize(150);
    setStoreStateForTest(useSettingsStore);
    const html = renderToStaticMarkup(<GlobalSettings />);

    expect(tag(html, "settings-interface-size")).toContain('value="150"');
  });
});

describe("the Warnings settings tab", () => {
  afterEach(() => {
    restoreStoresForTest();
    resetSettingsStore();
  });

  it("renders one toggle per advisory code, grouped Studying/Teaching / Resources / Guarding / Orders / Building / Sailing", () => {
    resetSettingsStore();
    const html = renderToStaticMarkup(<WarningSettings />);

    expect(html).toContain("Studying/Teaching");
    expect(html).toContain("Resources");
    expect(html).toContain("Guarding");
    expect(html).toContain("Orders");
    expect(html).toContain("Building");
    expect(html).toContain("Sailing");

    const titles = [
      "Teachers with free slots",
      "Oversubscribed teachers",
      "Teachers lacking the skill",
      "Students not studying",
      "Students elsewhere",
      "Overspent silver",
      "Overdrawn items",
      "Dropped guards",
      "Unguarded hexes",
      "Reused FORM numbers",
      "Gifts to units that are not here",
      "Overloaded units",
      "Units that do nothing",
      "Building what is built",
      "Building outside a structure",
      "Helping a unit that is not building",
      "Overloaded fleets",
      "Undercrewed fleets",
      "More quartermasters than allowed",
      "Producing in too many regions"
    ];
    for (const title of titles) {
      expect(html).toContain(title);
    }

    // One toggle per code the wire actually carries - a title added here without a code, or a
    // code without a title, would otherwise go unnoticed.
    for (const code of ADVISORY_CHECK_CODES) {
      expect(html).toContain(`data-testid="settings-warning-${code}"`);
    }
  });

  it("starts every check on, except the unguarded-hex one", () => {
    resetSettingsStore();
    const html = renderToStaticMarkup(<WarningSettings />);

    expect(tag(html, "settings-warning-hex-unguarded")).not.toContain('checked=""');
    for (const code of ADVISORY_CHECK_CODES) {
      if (code === "hex-unguarded") {
        continue;
      }
      expect(tag(html, `settings-warning-${code}`)).toContain('checked=""');
    }
  });

  it("reflects a toggled check", () => {
    resetSettingsStore();
    useSettingsStore.getState().setAdvisoryCheck("not-enough-silver", false);
    setStoreStateForTest(useSettingsStore);

    const html = renderToStaticMarkup(<WarningSettings />);

    expect(tag(html, "settings-warning-not-enough-silver")).not.toContain('checked=""');
  });
});

/**
 * The whole-table reset for the units table's dragged column widths (ah-1owr.2). That it actually
 * clears the store is pinned in `workspaceStore.test.ts` and end to end in the smoke suite; what
 * matters here is that it exists, is named as the navigator settled it, and is reachable.
 */
describe("the units table's column widths (ah-1owr.2)", () => {
  it("offers a way to put the units table's columns back", () => {
    const html = renderToStaticMarkup(<GlobalSettings />);

    expect(html).toContain("Units table columns");
    expect(tag(html, "settings-reset-column-widths")).toContain("<button");
    expect(html).toContain("Reset widths");
  });

  it("offers a way to put the column order back", () => {
    const html = renderToStaticMarkup(<GlobalSettings />);

    expect(tag(html, "settings-reset-column-order")).toContain("<button");
    expect(html).toContain("Reset order");
    // Two buttons, not one: order and widths are stored separately, so undoing one must not cost
    // the other (ah-1owr.3).
    expect(tag(html, "settings-reset-column-widths")).toContain("<button");
  });
});
