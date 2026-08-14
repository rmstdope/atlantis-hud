import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OrdersImportPrompt } from "./OrdersImportPrompt";

function draw(overrides: Partial<Parameters<typeof OrdersImportPrompt>[0]> = {}) {
  return renderToStaticMarkup(
    <OrdersImportPrompt
      fileName="orders-turn-71.txt"
      factionLabel="Borg TNG (95)"
      turnNumber={71}
      unitCount={34}
      emptiedCount={3}
      busy={false}
      onCancel={() => {}}
      onReplace={() => {}}
      {...overrides}
    />
  );
}

describe("OrdersImportPrompt", () => {
  it("states the counts and the overwrite in numbers", () => {
    const markup = draw();

    expect(markup).toContain('data-testid="orders-import-prompt"');
    expect(markup).toContain("orders-turn-71.txt");
    expect(markup).toContain("Orders for 34 units of Borg TNG (95), turn 71.");
    expect(markup).toContain(
      "This replaces all current orders for this turn — 3 units with orders now are not in the " +
        "file and will end up with none."
    );
    expect(markup).toContain('data-testid="orders-import-cancel"');
    expect(markup).toContain('data-testid="orders-import-replace"');
  });

  it("drops the overwrite sentence when nothing would be emptied", () => {
    const markup = draw({ emptiedCount: 0 });

    expect(markup).toContain("Orders for 34 units of Borg TNG (95), turn 71.");
    expect(markup).not.toContain("This replaces all current orders");
  });

  it("says one unit rather than 1 units", () => {
    const markup = draw({ unitCount: 1, emptiedCount: 1 });

    expect(markup).toContain("Orders for 1 unit of Borg TNG (95), turn 71.");
    expect(markup).toContain("1 unit with orders now");
  });

  it("disables Replace while busy but leaves Cancel enabled", () => {
    const markup = draw({ busy: true });

    expect(markup).toMatch(/data-testid="orders-import-replace"[^>]*disabled/);
    expect(markup).not.toMatch(/data-testid="orders-import-cancel"[^>]*disabled/);
  });
});
