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

  // ah-7rd: the events list was one flat run of lines, so following one unit through a turn meant
  // reading the whole list and remembering.
  describe("the events list is grouped by unit", () => {
    const EVENTS = [
      "Times reward of 200 silver.",
      "Taxers (8047): Gives 50 silver [SILV] to Lookout (12159).",
      "Woodsmen (9431): Gives 20 wood [WOOD] to Smiths (11933).",
      "Taxers (8047): Claims $878."
    ];

    const renderEvents = (knownUnitIds: ReadonlySet<string> = new Set(["8047", "9431"])) =>
      renderToStaticMarkup(
        <TurnMessagesPanel
          turnLabel="71"
          errors={[]}
          events={EVENTS}
          tab="events"
          onTab={() => {}}
          knownUnitIds={knownUnitIds}
          onSelectUnit={() => {}}
          onDismiss={() => {}}
        />
      );

    it("shows one group per unit, headed by name and number", () => {
      const markup = renderEvents();

      expect(markup).toContain('data-testid="turn-messages-group-general"');
      expect(markup).toContain('data-testid="turn-messages-group-8047"');
      expect(markup).toContain('data-testid="turn-messages-group-9431"');
      expect(markup).not.toContain('data-testid="turn-messages-group-12159"');
      expect(markup).toContain("Taxers (8047)");
      expect(markup).toContain("General");
    });

    it("the group heading is the way back to the map", () => {
      expect(renderEvents()).toContain('data-testid="turn-messages-unit-8047"');

      const unknown = renderEvents(new Set(["9431"]));
      expect(unknown).not.toContain('data-testid="turn-messages-unit-8047"');
      expect(unknown).toContain("Taxers (8047)");
    });

    it("every group is open", () => {
      const markup = renderEvents();

      for (const text of [
        "Times reward of 200 silver.",
        "Gives 50 silver [SILV] to Lookout (12159).",
        "Gives 20 wood [WOOD] to Smiths (11933).",
        "Claims $878."
      ]) {
        expect(markup).toContain(text);
      }
      expect(markup).not.toContain("<details");
    });

    it("leaves the errors tab a flat list", () => {
      const markup = renderToStaticMarkup(
        <TurnMessagesPanel
          turnLabel="71"
          errors={["Unit (1387): BUY: Unit attempted to buy more than it could afford."]}
          events={EVENTS}
          tab="errors"
          onTab={() => {}}
          knownUnitIds={new Set(["1387"])}
          onSelectUnit={() => {}}
          onDismiss={() => {}}
        />
      );

      expect(markup).toContain('data-testid="turn-messages-row-0"');
      expect(markup).not.toContain('data-testid="turn-messages-group-');
      expect(markup).toContain("BUY");
    });
  });
});
