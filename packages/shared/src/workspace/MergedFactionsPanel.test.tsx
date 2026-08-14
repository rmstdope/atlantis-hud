import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MergedFactionsPanel } from "./MergedFactionsPanel";

describe("MergedFactionsPanel", () => {
  // ah-cp8: the list body used to be capped at a fixed 40vh regardless of how much window there
  // was to use.
  it("the body is clamped to the window, not to 40vh", () => {
    const markup = renderToStaticMarkup(
      <MergedFactionsPanel turnLabel="71" merged={[]} onDismiss={() => {}} />
    );
    expect(markup).toContain("max-h-[calc(100vh-6rem)]");
    expect(markup).not.toContain("max-h-[40vh]");
  });
});
