import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { ProblemWho, SeverityMark } from "./primitives";

describe("SeverityMark", () => {
  it("marks a warning with an amber glyph and the word warning", () => {
    const markup = renderToStaticMarkup(<SeverityMark severity="warning" />);

    expect(markup).toContain("⚠");
    expect(markup).toContain("text-warn");
    expect(markup).toContain("aria-hidden");
    expect(markup).toContain(">warning<");
  });

  it("marks an error with a red cross and the word error", () => {
    const markup = renderToStaticMarkup(<SeverityMark severity="error" />);

    expect(markup).toContain("✕");
    expect(markup).toContain("text-danger");
    expect(markup).toContain(">error<");
    expect(markup).not.toContain("text-warn");
  });
});

describe("ProblemWho", () => {
  it("names the unit, and says so for a screen reader", () => {
    const markup = renderToStaticMarkup(<ProblemWho unitId="2042" />);

    expect(markup).toContain("2042");
    expect(markup).toContain(">unit <");
  });

  it("says hex when the problem belongs to no unit", () => {
    const markup = renderToStaticMarkup(<ProblemWho unitId={null} />);

    expect(markup).toContain(">hex<");
    expect(markup).toContain("italic");
    expect(markup).toContain("the whole hex");
  });
});
