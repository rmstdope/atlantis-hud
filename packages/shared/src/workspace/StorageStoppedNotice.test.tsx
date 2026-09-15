import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StorageStoppedNotice } from "./StorageStoppedNotice";

const WORDS = {
  heading: "Atlantis HUD was updated in another tab",
  text: "A newer version of Atlantis HUD is open in another tab, so this one has stopped. Your orders are saved. Reload this tab to carry on here, or close it.",
  button: "Reload"
};

describe("the stopped notice", () => {
  const markup = renderToStaticMarkup(<StorageStoppedNotice words={WORDS} onReload={() => {}} />);

  it("shows its heading, sentence and button as a modal alert dialog", () => {
    expect(markup).toContain(WORDS.heading);
    expect(markup).toContain("so this one has stopped. Your orders are saved.");
    expect(markup).toContain(">Reload<");
    expect(markup).toContain('role="alertdialog"');
    expect(markup).toContain('aria-modal="true"');
  });

  it("greys out the tab behind it", () => {
    expect(markup).toContain("bg-black/50");
  });

  it("offers Reload and nothing else", () => {
    expect(markup).not.toContain(">Close<");
    expect(markup.match(/<button/gu)).toHaveLength(1);
  });
});
