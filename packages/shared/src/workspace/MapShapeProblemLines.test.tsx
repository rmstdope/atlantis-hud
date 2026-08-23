import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { mapShapeProblems } from "../mapShape";
import { MapShapeProblemLines } from "./MapShapeProblemLines";

describe("the lines a form shows about wrapping it cannot draw", () => {
  it("renders the refusal against the axis it is about", () => {
    const markup = renderToStaticMarkup(
      <MapShapeProblemLines
        problems={mapShapeProblems({ width: "71", height: "96", wrapX: true, wrapY: false })}
        testidPrefix="game-map-problem"
      />
    );

    expect(markup).toContain('data-testid="game-map-problem-x"');
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("A 71-wide map cannot wrap east-west");
    expect(markup).toContain("Use an even width, or turn off east-west wrap.");
  });

  it("shows both lines when both axes are wrong", () => {
    const markup = renderToStaticMarkup(
      <MapShapeProblemLines
        problems={mapShapeProblems({ width: "71", height: "95", wrapX: true, wrapY: true })}
        testidPrefix="settings-map-problem"
      />
    );

    expect(markup).toContain('data-testid="settings-map-problem-x"');
    expect(markup).toContain('data-testid="settings-map-problem-y"');
    expect(markup).toContain("A 95-high map cannot wrap north-south");
  });

  it("renders nothing at all for a map that is fine", () => {
    const markup = renderToStaticMarkup(
      <MapShapeProblemLines
        problems={mapShapeProblems({ width: "72", height: "96", wrapX: true, wrapY: true })}
        testidPrefix="game-map-problem"
      />
    );

    expect(markup).toBe("");
  });
});
