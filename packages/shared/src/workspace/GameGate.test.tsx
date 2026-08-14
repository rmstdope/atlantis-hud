import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GameGate } from "./GameGate";

const draw = (overrides: Partial<Parameters<typeof GameGate>[0]> = {}) =>
  renderToStaticMarkup(
    <GameGate
      busy={false}
      error={null}
      onCreate={() => {}}
      onImport={() => {}}
      settingsOpen={false}
      onToggleSettings={() => {}}
      settings={null}
      {...overrides}
    />
  );

describe("GameGate header", () => {
  // ah-cp8: mirrors AppHeader's root class so the no-game screen wraps the same way instead of
  // drifting back to a fixed-height bar.
  it("the header wraps like the workspace header, not a fixed height", () => {
    const markup = draw();
    const headerMatch = markup.match(/<header[^>]*class="([^"]*)"/);
    expect(headerMatch).not.toBeNull();
    const headerClass = headerMatch![1];
    expect(headerClass).toContain("flex-wrap");
    expect(headerClass).toContain("min-h-9");
    expect(headerClass.split(/\s+/)).not.toContain("h-9");
  });
});
