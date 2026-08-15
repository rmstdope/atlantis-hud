# ah-gth — retrospective

- **Implementer:** Wolverine
- **Date:** 2026-08-15
- **PR:** (opened alongside this commit)

## `content: none` on a real (non-pseudo) element computes back to `"normal"`, not `"none"`

**What happened.** The plan called for suppressing CodeMirror's stock lint-marker icon — a
`content: url(data:image/svg+xml,...)` rule from `@codemirror/lint`'s baseTheme — by overriding
`content: none` on `.cm-lint-marker`. A review agent recommended pinning that suppression with
`await expect(marker).toHaveCSS("content", "none")`, on top of the background-colour assertion,
since a `background-color` check alone would still pass if the stock icon ever crept back (a
`content` replaced element paints over its own background). Written that way, the assertion failed
in Chromium with `Expected: "none", Received: "normal"` — even though the fix itself worked and
the icon was genuinely suppressed (confirmed by inspecting the rendered `backgroundColor` and by a
throwaway probe page).

**Why.** Chromium's computed style for `content: none` on an ordinary (non-`::before`/`::after`)
element reports back `"normal"` — the property's own initial value — rather than the literal
keyword `"none"`. This is not documented anywhere obvious and is easy to mistake for "the override
never applied." A second throwaway probe (`content: url(...)`) confirmed the contrast: a *winning*
`content` override computes to the resolved `url("...")` string, while `none` collapses to
`"normal"`. Mutation-testing the final assertion (temporarily deleting both `content: "none"`
declarations from the theme block and re-running) confirmed the test does discriminate a real
regression — it just needed the right expected string.

**Cost.** About 20 minutes: one wrong assertion, a wall of confusing desktop-shell + web failures
across the whole suite (all downstream of the same one wrong string), two throwaway probe specs to
isolate the browser's actual behaviour, and one mutation-test round to confirm the corrected
assertion still discriminates before trusting it.

**Prevent by.** When asserting a CSS `content` override on a normal element from a review
suggestion (or from first principles) rather than copying a known-passing pattern, treat the
expected computed value as unverified until probed — `page.evaluate` a two-line throwaway that sets
the property inline and reads `getComputedStyle(...).content` back, the same check done here after
the fact. Nothing in the codebase says this explicitly yet; if it recurs, this note is one
candidate for a `test-driven-development` skill addition (a browser-CSS-computed-value entry
alongside the existing `content: url(data:...)` / `Control+Shift+Z` ones), which is the navigator's
call, not this implementer's.

**Seen before.** None found.
