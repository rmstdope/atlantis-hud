import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TurnPicker } from "./TurnPicker";

const turns = [
  { key: { factionId: "95", turnNumber: 68 }, season: "September, Year 6" },
  { key: { factionId: "95", turnNumber: 69 }, season: null },
  { key: { factionId: "95", turnNumber: 70 }, season: "November, Year 6" },
  { key: { factionId: "95", turnNumber: 71 }, season: "December, Year 6" }
];

describe("TurnPicker", () => {
  it("lists the turns in turn order and marks the playing and compared turns", () => {
    const markup = renderToStaticMarkup(
      <TurnPicker
        turns={turns}
        workingTurn={71}
        comparedTurn={70}
        onSelect={() => {}}
        onDismiss={() => {}}
      />
    );

    const rowOrder = ["turn-row-68", "turn-row-69", "turn-row-70", "turn-row-71"].map((testid) =>
      markup.indexOf(testid)
    );
    expect(rowOrder).toEqual([...rowOrder].sort((a, b) => a - b));

    expect(markup).toContain('data-testid="turn-row-71"');
    expect(markup).toContain("●");
    expect(markup).toContain("playing");

    expect(markup).toContain('data-testid="turn-row-70"');
    expect(markup).toContain("⇄");
    expect(markup).toContain("compare");

    // A turn whose season could not be read still gets a row, showing the bare number.
    expect(markup).toContain('data-testid="turn-row-69"');
  });

  it("shows only the playing row and the hint for a game with one turn", () => {
    const markup = renderToStaticMarkup(
      <TurnPicker
        turns={[{ key: { factionId: "95", turnNumber: 71 }, season: "December, Year 6" }]}
        workingTurn={71}
        comparedTurn={null}
        onSelect={() => {}}
        onDismiss={() => {}}
      />
    );

    expect(markup).toContain('data-testid="turn-row-71"');
    expect(markup).not.toContain('data-testid="turn-row-70"');
  });
});
