import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ADVISORY_CHECK_CODES } from "@atlantis/core-client";
import { resetSettingsStore, useSettingsStore } from "../settingsStore";
import { WarningSettings } from "./SettingsDialog";

/**
 * `renderToStaticMarkup` runs with no `window`, so React treats it as a server render and the
 * store's React binding reads `getInitialState()` rather than `getState()` - see
 * `UnitTableDock.test.tsx` for the same trap. Mocked here the same way, so a setting changed for
 * one of these tests is what the render sees.
 */
vi.mock("../settingsStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../settingsStore")>();
  return {
    ...actual,
    useSettingsStore: Object.assign(
      (selector: (state: ReturnType<typeof actual.useSettingsStore.getState>) => unknown) =>
        selector(actual.useSettingsStore.getState()),
      actual.useSettingsStore
    )
  };
});

/** The markup of one testid's tag, so an assertion about it cannot match a sibling's attribute. */
function tag(html: string, testid: string): string {
  const match = html.match(new RegExp(`<[^>]*data-testid="${testid}"[^>]*>`));
  if (!match) {
    throw new Error(`no element carries data-testid="${testid}"`);
  }
  return match[0];
}

describe("the Warnings settings tab", () => {
  afterEach(() => {
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
      "Building what is built",
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

    const html = renderToStaticMarkup(<WarningSettings />);

    expect(tag(html, "settings-warning-not-enough-silver")).not.toContain('checked=""');
  });
});
