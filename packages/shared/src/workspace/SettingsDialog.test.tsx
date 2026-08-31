import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { ADVISORY_CHECK_CODES } from "@atlantis/core-client";
import { resetSettingsStore, useSettingsStore } from "../settingsStore";
import { renderWithStoreState, restoreStoresForTest } from "../testing/storeState";
import { RULESETS } from "../rulesets";
import { UNSUPPORTED_UPDATES } from "./appUpdate";
import { mapCommitOf } from "../mapShape";
import {
  About,
  GameMapSettings,
  GlobalSettings,
  WARNING_GROUPS,
  WarningSettings
} from "./SettingsDialog";

/**
 * `ah-v9p2`. The titles and descriptions are user-facing copy and stay here, but a code that has no
 * entry at all is a gap nothing used to notice: the dialog simply did not offer a toggle for it.
 * A typo was already caught by `AdvisoryCheckCode`; an omission was not.
 */
describe("the warnings tab's coverage of the core's codes", () => {
  it("lists every advisory check code exactly once", () => {
    const listed = WARNING_GROUPS.flatMap((group) => group.entries.map((entry) => entry.code));

    expect([...listed].sort()).toEqual([...ADVISORY_CHECK_CODES].sort());
    expect(listed.length).toBe(new Set(listed).size);
  });
});

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
    const slider = tag(
      renderWithStoreState(<GlobalSettings />, useSettingsStore, {
        theme: "light",
        paneTransparency: { dark: 40, light: 15 }
      }),
      "pane-transparency"
    );

    expect(slider).toContain('value="15"');
  });

  it("shows the dark value again when dark is the active theme", () => {
    resetSettingsStore();
    const slider = tag(
      renderWithStoreState(<GlobalSettings />, useSettingsStore, {
        theme: "dark",
        paneTransparency: { dark: 40, light: 15 }
      }),
      "pane-transparency"
    );

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
    const html = renderWithStoreState(<GlobalSettings />, useSettingsStore);

    expect(tag(html, "settings-interface-size")).toContain('value="150"');
  });
});

describe("the Warnings settings tab", () => {
  afterEach(() => {
    restoreStoresForTest();
    resetSettingsStore();
  });

  it("renders one toggle per advisory code, grouped Studying/Teaching / Resources / Guarding / Orders / Building / Producing / Sailing", () => {
    resetSettingsStore();
    const html = renderToStaticMarkup(<WarningSettings />);

    expect(html).toContain("Studying/Teaching");
    expect(html).toContain("Resources");
    expect(html).toContain("Guarding");
    expect(html).toContain("Orders");
    expect(html).toContain("Building");
    expect(html).toContain("Producing");
    expect(html).toContain("Sailing");

    const titles = [
      "Teachers with free slots",
      "Oversubscribed teachers",
      "Teachers lacking the skill",
      "Students not studying",
      "Students elsewhere",
      "Overspent silver",
      "Overdrawn items",
      "Guards that cannot take watch",
      "Dropped guards",
      "Unguarded hexes",
      "Reused FORM numbers",
      "Gifts to units that are not here",
      "Taking from another faction",
      "Overloaded units",
      "Units that do nothing",
      "Building what is built",
      "Building outside a structure",
      "Helping a unit that is not building",
      "Building without the skill",
      "Producing without the skill",
      "Producing what the region has not",
      "Overloaded fleets",
      "Undercrewed fleets",
      "More quartermasters than allowed",
      "Producing in too many regions",
      "Claiming more than the faction has",
      "Upkeep the faction cannot pay",
      "Taxing a hex you are pillaging",
      "Pillaging without the men",
      "Taxing without combat-ready men",
      "Promised more than the region has",
      "Taxing a hex someone else guards"
    ];
    for (const title of titles) {
      expect(html).toContain(title);
    }
    expect(html).toContain(
      "A GIVE or TAKE naming items that cannot change hands, or men given to another faction."
    );
    expect(html).toContain(
      "A GUARD 1 order given to a unit that cannot tax and therefore cannot guard."
    );
    expect(html).toContain(
      "A TAKE naming a visible unit from another faction, which the game will refuse."
    );

    // Two orders draw on the one fund, and the description is where that detail lives - the row's
    // title stays what a returning user looks for (`ah-tdsi`).
    expect(html).toContain(
      "CLAIM and WITHDRAW orders across all your units asking for more unclaimed silver than the faction holds."
    );

    // A pillage empties the hex before any TAX reaches it, and the description is what says so
    // (`ah-cxxa`). Asserted against the escaped markup, because React escapes the apostrophe in
    // "region's" - the shipped string itself is the plain one.
    expect(html).toContain(
      "TAX orders in a hex where one of your own units is ordered to PILLAGE, which collects the region&#x27;s money first."
    );
    expect(html).toContain(
      "A TAX order or taxing flag on a unit with no combat-ready men."
    );

    // A race may stop a unit short of the skill's own maximum, and the description is what says so
    // (`ah-9hp7.2`). The title stays what a returning user looks for.
    expect(html).toContain("Study with nothing to learn");
    expect(html).toContain(
      "A unit ordered to study a skill that at least one of its races cannot learn any further."
    );

    // A foreign guard may block the order outright, and the description is what says so
    // (`ah-g7ts`).
    expect(html).toContain(
      "TAX and PILLAGE orders in a hex where another faction has a unit on guard, which can block them."
    );

    // A region's pools are shared, and the description is what says which of them this is about
    // (`ah-t2pn.4`). Asserted against the escaped markup, because React escapes the apostrophe in
    // "region or its market" - the shipped string itself is the plain one.
    expect(html).toContain(
      "Your units in one hex ordered to tax, work, entertain or trade for more than the region or its market can supply between them."
    );

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
    const html = renderWithStoreState(<WarningSettings />, useSettingsStore);

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

describe("the map layer settings", () => {
  afterEach(() => {
    restoreStoresForTest();
    resetSettingsStore();
  });

  it("offers Staleness and Movement in the Global tab, with the hints the chips' names imply", () => {
    // They used to sit in the strip over the map (ah-l9mp). They are set once and then forgotten,
    // so they belong beside the other display preferences and give the band back to the map.
    const html = renderToStaticMarkup(<GlobalSettings />);

    expect(html).toContain("Staleness");
    expect(html).toContain("Shade hexes by how long ago you last saw them.");
    expect(html).toContain("Movement");
    expect(html).toContain("Draw the routes units are ordered to travel.");
    expect(tag(html, "settings-layer-staleness")).toContain('type="checkbox"');
    expect(tag(html, "settings-layer-movement")).toContain('type="checkbox"');
  });

  it("shows each layer's current state", () => {
    const html = renderToStaticMarkup(<GlobalSettings />);

    // Both layers start on, as the workspace store's initial state has them.
    expect(tag(html, "settings-layer-staleness")).toContain("checked");
    expect(tag(html, "settings-layer-movement")).toContain("checked");
  });
});

describe("the upkeep setting (ah-1wcw.4)", () => {
  afterEach(() => {
    restoreStoresForTest();
    resetSettingsStore();
  });

  it("offers it in the Global tab, checked, saying what it charges and how food pays", () => {
    const html = renderToStaticMarkup(<GlobalSettings />);

    expect(html).toContain("Count upkeep in the Silver column");
    expect(html).toContain(
      "Charge each unit its monthly maintenance - 10 silver a character, 50 a leader - paid with food first where the unit is set to consume it."
    );
    expect(tag(html, "settings-count-upkeep")).toContain('type="checkbox"');
    // On by default: upkeep is a real cost every month.
    expect(tag(html, "settings-count-upkeep")).toContain("checked");
  });

  it("reflects the setting turned off", () => {
    const html = renderWithStoreState(<GlobalSettings />, useSettingsStore, {
      countUpkeep: false
    });

    expect(tag(html, "settings-count-upkeep")).not.toContain("checked");
  });
});

describe("About", () => {
  const html = () =>
    renderToStaticMarkup(
      <About
        platformLabel="Desktop (Windows)"
        appUpdate={UNSUPPORTED_UPDATES}
        openExternal={() => undefined}
      />
    );

  const text = () => html().replace(/<[^>]*>/g, " ").replace(/&#x27;/g, "'");

  it("says what the app is, what it needs, and where to report a problem", () => {
    const screenText = text();
    expect(screenText).toContain("the play-by-email game");
    expect(screenText).toContain("the particular Atlantis variant");
    expect(screenText).toContain("project's issue page");
  });

  it("reads the variants from the build rather than restating them", () => {
    const screenText = text();
    expect(screenText).toContain(RULESETS.map((ruleset) => ruleset.label).join(", "));
    expect(html()).toContain('data-testid="app-variants"');
  });

  it("never calls the app web based, which the Build row above it contradicts", () => {
    expect(text().toLowerCase()).not.toContain("web based");
  });

  it("gives the issue page a button rather than an anchor, so the desktop shell can open it", () => {
    const markup = html();
    expect(markup).toContain('data-testid="about-issues-link"');
    expect(markup).not.toContain("<a ");
  });
});

describe("a per-game map whose wrapping cannot be drawn", () => {
  it("does not commit a map whose wrapping cannot be drawn", () => {
    // This form has no Save button - numbers commit on blur and checkboxes at once - so the
    // refusal is a guard on the commit itself: the game keeps the map it had.
    expect(mapCommitOf({ width: "71", height: "96", wrapX: true, wrapY: false })).toBeNull();
    expect(mapCommitOf({ width: "72", height: "95", wrapX: false, wrapY: true })).toBeNull();
  });

  it("commits again as soon as either field makes the pair valid", () => {
    expect(mapCommitOf({ width: "72", height: "96", wrapX: true, wrapY: false })).toEqual({
      store: { width: 72, height: 96, wrapX: true, wrapY: false }
    });
    expect(mapCommitOf({ width: "71", height: "96", wrapX: false, wrapY: false })).toEqual({
      store: { width: 71, height: 96, wrapX: false, wrapY: false }
    });
  });

  it("still records nothing for cleared fields", () => {
    expect(mapCommitOf({ width: "", height: "", wrapX: true, wrapY: true })).toEqual({
      store: undefined
    });
  });

  it("shows the refusal beside the fields, keeping what was typed", () => {
    const markup = renderToStaticMarkup(
      <GameMapSettings
        map={{ width: 71, height: 96, wrapX: true, wrapY: false }}
        stated
        busy={false}
        onChangeMap={() => {}}
      />
    );

    expect(markup).toContain('data-testid="settings-map-problem-x"');
    expect(markup).toContain("A 71-wide map cannot wrap east-west");
    expect(markup).toContain('value="71"');
  });
});
