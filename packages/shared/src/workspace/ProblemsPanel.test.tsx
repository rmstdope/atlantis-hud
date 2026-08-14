import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProblemsPanel } from "./ProblemsPanel";

describe("ProblemsPanel", () => {
  // ah-cp8: the list body used to be capped at a fixed 50vh regardless of how much window there
  // was to use.
  it("the body is clamped to the window, not to 50vh", () => {
    const markup = renderToStaticMarkup(
      <ProblemsPanel
        hexes={[]}
        labelFor={(regionId) => regionId}
        onSelectHex={() => {}}
        onDismiss={() => {}}
      />
    );
    expect(markup).toContain("max-h-[calc(100vh-6rem)]");
    expect(markup).not.toContain("max-h-[50vh]");
  });
});
