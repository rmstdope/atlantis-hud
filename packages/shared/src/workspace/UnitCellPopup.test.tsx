import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PopupLine } from "../unitCellPopup";
import { PopupLineValue } from "./UnitCellPopup";

const draw = (line: PopupLine) => renderToStaticMarkup(<PopupLineValue line={line} />);

describe("PopupLineValue", () => {
  it("a figure that rose is drawn as the pair, the new figure in the up colour", () => {
    const markup = draw({ label: "men", value: "12", change: { direction: "up", from: "8" } });
    expect(markup).toMatch(/8[\s\S]*→[\s\S]*12/);
    expect(markup).toMatch(/text-ok[^>]*>12</);
  });

  it("a figure that fell puts the new figure in the down colour", () => {
    const markup = draw({ label: "horse", value: "2", change: { direction: "down", from: "3" } });
    expect(markup).toMatch(/3[\s\S]*→[\s\S]*2/);
    expect(markup).toMatch(/text-danger[^>]*>2</);
  });

  it("a figure that did not move is drawn on its own", () => {
    const markup = draw({ label: "silver", value: "40" });
    expect(markup).not.toContain("→");
    expect(markup).not.toContain("text-ok");
    expect(markup).not.toContain("text-danger");
  });
});
