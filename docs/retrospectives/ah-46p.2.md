# ah-46p.2 — retrospective

- **Implementer:** Storm
- **Date:** 2026-08-17
- **PR:** #374

## A map-label smoke-test probe was silently invisible at the default zoom

**What happened.** The new smoke test read a map label's computed `font-size` to prove the
Interface size setting never reaches the map. The first selector used was `.region-name`, the
class the plan itself names as the map's own type. Once the Copilot review's "assert visible
before `boundingBox()`" comment was applied, the added `await expect(mapLabel).toBeVisible()`
failed outright — `.region-name` is hidden at the map's default zoom band by
`.map-far .region-name { display: none }` in `theme.css:288`. The earlier version of the test had
called `.evaluate()` directly on a detached/invisible element without ever asserting visibility, so
it had been silently reading `getComputedStyle()` off an element nobody could see, rather than
failing loudly.

**Why.** The map has a zoom-band policy — several classes and rules only apply, or stop applying,
above or below a zoom threshold — and `theme.css`'s own comments document this for at least this one
class. Choosing a map-text selector for a smoke assertion without checking whether it survives the
suite's default (unzoomed) view produces a probe that is either flaky or, worse, silently reading a
hidden element.

**Cost.** One review round trip: the flakiness wasn't caught locally before the PR opened, because
the original test read `.evaluate()` on the element without ever checking it was visible, so
nothing failed until the review's visibility-assertion suggestion was applied and re-run. Fixed by
swapping to the map's ruler ticks (`[data-testid="map-ruler-x"] text`), which render at every zoom
level and carry an explicit inline `fontSize` untouched by CSS classes.

**Prevent by.** When a smoke test needs to read a computed style off a map element, prefer an
element known to render unconditionally (the rulers, or anything outside the theme's zoom-band
rules) over a class-styled element like `.region-name`/`.region-outline` whose visibility is
zoom-dependent — and always assert visibility before reading a computed style from any element
whose presence isn't already guaranteed by an earlier assertion in the same test.

**Seen before.** None found.
