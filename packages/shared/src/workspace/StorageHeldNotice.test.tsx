import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StorageHeldNotice } from "./StorageHeldNotice";

const WORDS = {
  heading: "Midgard is open in another tab",
  text: "Another Atlantis HUD tab is holding on to this game's saved data, so it can't be opened here. Close the other Atlantis HUD tabs, then try again.",
  button: "Try again"
};

const draw = (overrides: Partial<Parameters<typeof StorageHeldNotice>[0]> = {}) =>
  renderToStaticMarkup(
    <StorageHeldNotice
      words={WORDS}
      retrying={false}
      placement="workspace"
      onTryAgain={() => {}}
      {...overrides}
    />
  );

describe("the held notice", () => {
  it("shows its heading, sentence and button as an alert dialog", () => {
    const markup = draw();
    expect(markup).toContain(WORDS.heading);
    expect(markup).toContain("Another Atlantis HUD tab is holding on to this game&#x27;s saved data");
    expect(markup).toContain(">Try again<");
    expect(markup).toContain('role="alertdialog"');
  });

  it("cannot be pressed while it is trying", () => {
    expect(draw({ retrying: true })).toMatch(/<button[^>]*disabled=""/u);
    expect(draw({ retrying: false })).not.toMatch(/<button[^>]*disabled=""/u);
  });

  it("sits over the workspace, or over the whole window when no game is open", () => {
    expect(draw({ placement: "workspace" })).toContain("absolute inset-0");
    expect(draw({ placement: "screen" })).toContain("fixed inset-0");
  });

  it("has no way to close it", () => {
    // The sentence itself says "Close the other Atlantis HUD tabs", so look for a control.
    expect(draw()).not.toContain(">Close<");
    expect(draw().match(/<button/gu)).toHaveLength(1);
  });
});
