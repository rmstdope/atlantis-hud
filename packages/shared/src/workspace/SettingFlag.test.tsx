import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { resetSettingsStore, useSettingsStore } from "../settingsStore";
import { renderWithStoreState, restoreStoresForTest } from "../testing/storeState";
import { SettingFlag } from "./SettingFlag";

describe("a boolean setting's toggle", () => {
  afterEach(() => {
    restoreStoresForTest();
    resetSettingsStore();
  });

  it("renders a setting's title, description and test id from its entry", () => {
    const html = renderToStaticMarkup(<SettingFlag name="orderOcd" />);

    expect(html).toContain("Order OCD");
    expect(html).toContain("Text inside quotes is left alone.");
    expect(html).toContain('data-testid="settings-order-ocd"');
    expect(html).not.toContain("checked");
  });

  it("is disabled while the setting it requires is off", () => {
    const html = renderWithStoreState(<SettingFlag name="animateWaterTextures" />, useSettingsStore, {
      biomeTextures: false
    });

    expect(html).toContain("disabled");
  });

  it("is available when it requires nothing", () => {
    expect(renderToStaticMarkup(<SettingFlag name="countUpkeep" />)).not.toContain("disabled");
  });
});
