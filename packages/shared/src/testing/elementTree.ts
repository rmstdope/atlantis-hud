/**
 * Finding an element in an unrendered React element tree, without a DOM.
 *
 * `packages/shared` has no jsdom (ah-nass; see `README.md` beside this file), so its component
 * tests render with `renderToStaticMarkup` and exercise a click by calling the button's own
 * `onClick` prop. Finding that button means walking the element tree by hand, which two test files
 * each did with a private copy of the same walk until ah-2ihm put it here.
 *
 * Test-only, like everything in this directory: nothing in production may import it, and
 * `packages/shared/src/index.ts` must not re-export it - there is no build step here, so a
 * re-export would ship test code to every consumer.
 */

/** An element found in an unrendered React element tree. Its props are what a test calls. */
export interface FoundElement {
  props: Record<string, unknown>;
}

/**
 * The first element carrying `data-testid`, or `null`.
 *
 * The nullable form, for a test asserting that something is **absent**. Where the id is expected
 * to be present, use `findByTestId` - it explains a miss instead of returning `null`.
 */
export function queryByTestId(node: unknown, testId: string): FoundElement | null {
  return walk(node, testId, new Set<string>());
}

/**
 * The first element carrying `data-testid`. Throws when there is none.
 *
 * The message names every component the walk could not enter. Calling a component outside a
 * renderer works only while it uses no hooks, and `PopoverFrame` does (`workspace/popover.tsx`,
 * ah-pdly) - so an id inside one is an id no test in this package can reach, and saying so is the
 * whole point of this function existing beside `queryByTestId`.
 */
export function findByTestId(node: unknown, testId: string): FoundElement {
  const skipped = new Set<string>();
  const found = walk(node, testId, skipped);
  if (found) {
    return found;
  }
  throw new Error(
    [
      `No element with data-testid="${testId}" in this tree.`,
      "",
      ...(skipped.size > 0
        ? [
            `The walk could not enter: ${[...skipped].join(", ")}.`,
            "Calling a component outside a renderer works only while it uses no hooks, so an id inside one of",
            "those is an id no test in packages/shared can reach - this package has no jsdom by decision.",
            "See packages/shared/src/testing/README.md."
          ]
        : [
            "Nothing in the tree carries it, and every component was entered successfully - so the id is",
            "genuinely absent rather than out of reach."
          ])
    ].join("\n")
  );
}

/**
 * The walk itself. `skipped` collects the components it could not enter, so a caller can say why a
 * miss was a miss.
 */
function walk(node: unknown, testId: string, skipped: Set<string>): FoundElement | null {
  if (node === null || typeof node !== "object") {
    return null;
  }
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = walk(child, testId, skipped);
      if (found) {
        return found;
      }
    }
    return null;
  }
  const element = node as { type?: unknown; props?: Record<string, unknown> };
  if (element.props?.["data-testid"] === testId) {
    return element as FoundElement;
  }
  // A function component (like `TradePanel` itself) has to be called to see what it renders; a
  // host element's children are already fully-formed React elements, needing no such call.
  if (typeof element.type === "function") {
    // Calling a component outside a renderer is only possible while it uses no hooks, and
    // `PopoverFrame` now does (ah-pdly: it takes focus when it opens). React throws in that case,
    // and every id this walk is asked for sits inside such a frame rather than on it - so falling
    // through to the children is the whole of the recovery.
    try {
      return walk((element.type as (props: unknown) => unknown)(element.props), testId, skipped);
    } catch {
      skipped.add((element.type as { name?: string }).name || "(anonymous component)");
      return walk(element.props?.children, testId, skipped);
    }
  }
  return walk(element.props?.children, testId, skipped);
}
