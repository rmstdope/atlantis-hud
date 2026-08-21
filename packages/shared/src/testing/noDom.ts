/**
 * What this package's tests cannot do, said to the person whose test is red.
 *
 * `packages/shared` has no jsdom. Its component tests render with `renderToStaticMarkup`, which
 * runs no effects, attaches no refs and fires no timers - and a zustand store read through
 * `useSyncExternalStore` shows a static render only its module-load default. Neither constraint
 * announces itself: the effect simply does not happen, and the assertion about what it should have
 * done fails for a reason that names neither the harness nor the cause. Four beads paid around
 * half an hour each to rediscover that (ah-t2i, ah-o1t.2, ah-1owr.3, ah-mwqa) before this file.
 *
 * `setup.ts` prints `NO_DOM_GUIDANCE` beside a failing test in a file that renders components, so
 * the explanation arrives while somebody is already looking at the red rather than in a document
 * they would have had to read first.
 *
 * Test-only, like everything in this directory: nothing in production may import it, and
 * `packages/shared/src/index.ts` must not re-export it.
 */

/** The paragraph a failing component test is shown. Its wording is the deliverable of ah-nass. */
export const NO_DOM_GUIDANCE = [
  "── packages/shared renders without a DOM ──",
  "There is no jsdom here. `renderToStaticMarkup` runs no effects, attaches no refs and fires no",
  "timers, so a rule written inside a component is a rule no test in this package can reach.",
  "",
  "If your red is a rule that never ran - and it fails silently, with no warning from React -",
  "move the rule into a pure module and test that.",
  "`workspace/dossierPeek.ts` is the worked example: `peekStep` is a plain function with its own",
  "test file and no React in sight. The measuring is a wrapper - `useReportedRect` in",
  "`workspace/FactionDossierPanel.tsx`, which reports a rect upward - and `workspace/MapCanvas.tsx`",
  "is what calls the rule. The smoke suite is where anything needing a real browser is checked.",
  "",
  "If your red is a store stuck in its default state: render through",
  "`testing/renderWithStoreState`, which applies the state where a static render can see it.",
  "A bare `store.setState(...)` before `renderToStaticMarkup` changes nothing.",
  "",
  "Honest limit: a genuinely effect-shaped rule still cannot be tested here. Moving it out of the",
  "component is the answer, not a workaround. This hint is printed for every red in a file that",
  "renders components, so it may have nothing to do with yours."
].join("\n");

/**
 * How a test file gives itself away as one that renders components. `renderWithStoreState` is here
 * as well as the bare import because a file that moved to the helper no longer names `react-dom`
 * anywhere, and it is exactly the kind of file the guidance is for.
 */
const RENDERS_COMPONENTS = ["react-dom/server", "renderWithStoreState"];

/**
 * The guidance, if this failing test is one the guidance could plausibly be about, and only the
 * first time for a given file - a file whose twelve tests all fail should say it once.
 */
export function noDomHintFor(
  testFilePath: string,
  testFileSource: string,
  alreadyShown: Set<string>
): string | null {
  if (!RENDERS_COMPONENTS.some((marker) => testFileSource.includes(marker))) {
    return null;
  }
  if (alreadyShown.has(testFilePath)) {
    return null;
  }
  alreadyShown.add(testFilePath);
  return NO_DOM_GUIDANCE;
}
