import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WholeFigure } from "./WholeFigure";

// Whether a figure is cut is measured in the browser, so it is pinned by the smoke suite
// (`ah-j92v`); here only what is drawn before anything has been measured.
describe("a Silver figure before it is measured", () => {
  it("is the whole figure, in the box the shortfall measures, with no ellipsis", () => {
    const markup = renderToStaticMarkup(<WholeFigure>12760</WholeFigure>);
    expect(markup).toContain("data-silver-figure");
    expect(markup).toContain(">12760<");
    expect(markup).not.toContain("data-figure-ellipsis");
  });
});
