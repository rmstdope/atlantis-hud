import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TurnMessagesPanel } from "./TurnMessagesPanel";

describe("TurnMessagesPanel", () => {
  // ah-cp8: the list body used to be capped at a fixed 60vh regardless of how much window there
  // was to use.
  it("the body is clamped to the window, not to 60vh", () => {
    const markup = renderToStaticMarkup(
      <TurnMessagesPanel
        turnLabel="71"
        errors={[]}
        events={[]}
        tab="errors"
        onTab={() => {}}
        knownUnitIds={new Set()}
        onSelectUnit={() => {}}
        onDismiss={() => {}}
      />
    );
    expect(markup).toContain("max-h-[calc(100vh-6rem)]");
    expect(markup).not.toContain("max-h-[60vh]");
  });
});
