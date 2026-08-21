import { useLayoutEffect, useRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NO_DOM_GUIDANCE, noDomHintFor } from "./noDom";

/**
 * The constraint this package lives under, written as tests so it is stated somewhere executable
 * rather than only in prose. `noDom.ts` is what actually says it to a person whose test is red.
 */

function Effectful() {
  const box = useRef<HTMLDivElement | null>(null);
  const measured = useRef(false);
  useLayoutEffect(() => {
    measured.current = true;
  }, []);
  return <div ref={box} data-measured={measured.current ? "yes" : "no"} />;
}

describe("this package renders without a DOM", () => {
  it("runs no effect and attaches no ref during a static render", () => {
    const markup = renderToStaticMarkup(<Effectful />);

    expect(
      markup,
      "renderToStaticMarkup ran an effect. If this package has gained a DOM environment, " +
        "NO_DOM_GUIDANCE and the pattern it names are now wrong and must be rewritten."
    ).toContain('data-measured="no"');
  });

  it("tells a person with a red component test what to do instead", () => {
    expect(NO_DOM_GUIDANCE).toContain("workspace/dossierPeek.ts");
    expect(NO_DOM_GUIDANCE).toContain("testing/renderWithStoreState");
    expect(NO_DOM_GUIDANCE).toMatch(/no jsdom|without a DOM/i);
  });

  it("offers the hint to a failing test that renders components, once per file", () => {
    const shown = new Set<string>();
    const source = 'import { renderToStaticMarkup } from "react-dom/server";';

    expect(noDomHintFor("a.test.tsx", source, shown)).toBe(NO_DOM_GUIDANCE);
    expect(noDomHintFor("a.test.tsx", source, shown)).toBeNull();
  });

  it("offers it to a file that renders only through the store helper", () => {
    const source = 'import { renderWithStoreState } from "../testing/storeState";';

    expect(noDomHintFor("c.test.tsx", source, new Set())).toBe(NO_DOM_GUIDANCE);
  });

  it("stays quiet for a failing test that renders nothing", () => {
    expect(noDomHintFor("b.test.ts", "export const x = 1;", new Set())).toBeNull();
  });
});
