import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CopyButton } from "./CopyButton";

/**
 * `renderToStaticMarkup` runs no effects and fires no timers, so the two-second flash is not
 * testable in this package (ah-nass) - the idle label is, and the click is proved in the smoke
 * suite.
 */
describe("CopyButton", () => {
  it("the_copy_button_renders_its_idle_label_and_test_id", () => {
    const html = renderToStaticMarkup(
      <CopyButton text="STUDY FORC" label="Copy" testId="study-planner-copy-95" className="rounded" />
    );
    expect(html).toContain('data-testid="study-planner-copy-95"');
    expect(html).toContain(">Copy</button>");
    expect(html).not.toContain("Copied");
  });
});
