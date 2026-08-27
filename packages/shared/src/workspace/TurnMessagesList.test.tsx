import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TurnMessagesList } from "./TurnMessagesList";

describe("TurnMessagesList", () => {
  // ah-cp8 clamped this body to the window rather than to a fixed 60vh; ah-30hg.2 moved that clamp
  // up to the turn-report panel, which holds four such bodies and must scroll once, not four times.
  it("the list does not scroll on its own - the report panel is the one scroller", () => {
    const markup = renderToStaticMarkup(
      <TurnMessagesList
        kind="errors"
        lines={[]}
        knownUnitIds={new Set()}
        onSelectUnit={() => {}}
      />
    );
    expect(markup).not.toContain("overflow-y-auto");
    expect(markup).not.toContain("max-h-[calc(100vh-6rem)]");
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
        <TurnMessagesList
          kind="events"
          lines={EVENTS}
          knownUnitIds={knownUnitIds}
          onSelectUnit={() => {}}
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

    it("leaves the errors list flat", () => {
      const markup = renderToStaticMarkup(
        <TurnMessagesList
          kind="errors"
          lines={["Unit (1387): BUY: Unit attempted to buy more than it could afford."]}
          knownUnitIds={new Set(["1387"])}
          onSelectUnit={() => {}}
        />
      );

      expect(markup).toContain('data-testid="turn-messages-row-0"');
      expect(markup).not.toContain('data-testid="turn-messages-group-');
      expect(markup).toContain("BUY");
    });

    // The two lists are one component now (ah-30hg.2), so which one a tab is showing has to be
    // legible from the markup - the smoke suite reads the panel by tab, not by panel id.
    it("says which of the two lists it is", () => {
      expect(renderEvents()).toContain('data-testid="turn-report-events"');
      expect(
        renderToStaticMarkup(
          <TurnMessagesList
            kind="errors"
            lines={[]}
            knownUnitIds={new Set()}
            onSelectUnit={() => {}}
          />
        )
      ).toContain('data-testid="turn-report-errors"');
    });
  });
});
