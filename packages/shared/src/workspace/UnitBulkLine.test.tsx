import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { UnitBulkLine } from "./UnitBulkLine";

const draw = (count: number, armyName: string | null) =>
  renderToStaticMarkup(
    <UnitBulkLine
      count={count}
      armyName={armyName}
      addTrigger={<button type="button" data-testid="bulk-add">Add to army…</button>}
      onRemove={() => {}}
      onClear={() => {}}
    />
  );

describe("the bulk line", () => {
  it("counts the picked units and offers Clear", () => {
    const markup = draw(3, null);

    // W1's words exactly. Never singular - the caller does not draw the line below two.
    expect(markup).toContain("3 units picked.");
    expect(markup).toContain('data-testid="bulk-clear"');
    expect(markup).toContain("Clear");
    expect(markup).toContain('data-testid="bulk-add"');
  });

  it("names the Army it would remove from", () => {
    const markup = draw(3, "Northern Host");

    // Naming it is what stops the button reading as *delete these units* (W1).
    expect(markup).toContain("Remove from Northern Host");
    expect(markup).toContain('data-testid="bulk-remove"');
  });

  it("offers no removal when the source is not an Army", () => {
    const markup = draw(2, null);

    expect(markup).not.toContain('data-testid="bulk-remove"');
    expect(markup).not.toContain("Remove from");
  });
});
