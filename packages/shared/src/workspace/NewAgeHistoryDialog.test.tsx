import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NewAgeHistoryDialog } from "./NewAgeHistoryDialog";
import { historyRows, type HistoryRow, type NewAgeHistoryPhase } from "./newAgeHistoryView";

function ready(
  over: Partial<Extract<NewAgeHistoryPhase, { kind: "ready" }>> = {}
): Extract<NewAgeHistoryPhase, { kind: "ready" }> {
  return {
    kind: "ready",
    worldTurns: [70, 71, 72],
    fetched: [],
    failures: new Map(),
    run: null,
    ...over
  };
}

function draw(
  phase: NewAgeHistoryPhase,
  rows: HistoryRow[] = [],
  missingCount = 0
): string {
  return renderToStaticMarkup(
    <NewAgeHistoryDialog
      worldName="Arcanum"
      phase={phase}
      rows={rows}
      missingCount={missingCount}
      onFetchTurn={() => {}}
      onFetchAllMissing={() => {}}
      onRetryList={() => {}}
      onDismiss={() => {}}
    />
  );
}

describe("NewAgeHistoryDialog", () => {
  it("says it is asking while the list is on its way", () => {
    const html = draw({ kind: "listing" });

    expect(html).toContain("Earlier turns on Arcanum");
    expect(html).toContain("Asking Arcanum which turns it holds…");
    expect(html).not.toContain("newage-history-list");
  });

  it("draws one row per turn with its mark", () => {
    const rows = historyRows(
      ready({ failures: new Map([[72, "no report"]]) }),
      [{ turnNumber: 70, season: "Winter, Year 2" }],
      71
    );

    const html = draw(ready({ failures: new Map([[72, "no report"]]) }), rows, 1);

    expect(html).toContain('data-testid="newage-history-row-70"');
    expect(html).toContain("Winter, Year 2");
    expect(html).toContain("stored");
    expect(html).toContain("playing");
    expect(html).toContain("no report");
    expect(html).toContain("—");
    expect(html).toContain("A fetched turn is stored for comparison.");
  });

  it("reads 'Fetch all 4 missing' with four to go and 'Fetch 1 missing' with one", () => {
    expect(draw(ready(), historyRows(ready(), [], null), 4)).toContain("Fetch all 4 missing");
    expect(draw(ready(), historyRows(ready(), [], null), 1)).toContain("Fetch 1 missing");
  });

  it("shows the run's progress on the button and disables the rows", () => {
    const phase = ready({ run: { turnNumber: 71, done: 1, total: 3 } });

    const html = draw(phase, historyRows(phase, [], null), 3);

    expect(html).toContain("Fetching 2 of 3…");
    expect(html).toContain("fetching…");
    expect(html.match(/<button[^>]*disabled/g) ?? []).toHaveLength(4);
  });

  it("offers Try again when the list itself failed", () => {
    const html = draw({ kind: "listFailed", message: "Arcanum would not say which turns it holds: no answer." });

    expect(html).toContain("Try again");
    expect(html).toContain('data-testid="newage-history-retry"');
    expect(html).toContain("would not say which turns it holds");
  });

  it("offers nothing to press when the world holds no earlier turns", () => {
    const html = draw({ kind: "empty" });

    expect(html).toContain("Arcanum holds no earlier turns for you.");
    expect(html).not.toContain("newage-history-fetch-all");
    expect(html).toContain('data-testid="newage-history-close"');
  });

  it("hides the primary button when nothing is missing", () => {
    const html = draw(ready(), historyRows(ready(), [], null), 0);

    expect(html).not.toContain("newage-history-fetch-all");
  });
});
