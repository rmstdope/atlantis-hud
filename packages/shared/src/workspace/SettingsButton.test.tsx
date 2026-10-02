import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SettingsButton } from "./SettingsButton";

/** ah-sw92: the dot a newer version leaves on the settings button, in both headers. */
describe("SettingsButton", () => {
  const draw = (mark?: { marked: boolean; settingsLabel: string }) =>
    renderToStaticMarkup(
      <SettingsButton settingsOpen={false} onToggleSettings={() => {}} mark={mark} settings={null} />
    );

  it("is a plain gear named Settings when nothing is newer", () => {
    const markup = draw();
    expect(markup).toContain('data-testid="settings-indicator"');
    expect(markup).toContain('aria-label="Settings"');
    // The tooltip appears only while a version is out.
    expect(markup).not.toContain("title=");
    expect(markup).not.toContain("settings-update-dot");
  });

  it("carries the dot, and names the version in its tooltip and accessible name", () => {
    const markup = draw({ marked: true, settingsLabel: "Settings — version 0.26.0 is available" });
    expect(markup).toContain('aria-label="Settings — version 0.26.0 is available"');
    expect(markup).toContain('title="Settings — version 0.26.0 is available"');
    const dot = markup.match(/<span[^>]*data-testid="settings-update-dot"[^>]*>/)![0];
    expect(dot).toContain('aria-hidden="true"');
    expect(dot).toContain("bg-brass");
    expect(dot).not.toContain("tabindex");
  });
});
