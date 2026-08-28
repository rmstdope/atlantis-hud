# ah-y9hx — retrospective

- **Implementer:** Storm
- **Date:** 2026-08-28
- **PR:** #774

## A units-table column header is clickable on this machine and out of reach in CI

**What happened.** The plan's keyboard walk sorted the table by `Id` so that `ArrowUp` from one row
was known to land on the other:

```ts
await page.getByTestId("panel-units").locator("thead").getByText("Id", { exact: true }).click();
```

It passed three separate local runs, including a full
`pnpm exec playwright test tests/smoke/workspace.spec.ts tests/smoke/armies.spec.ts tests/smoke/foreignUnits.spec.ts`
(393 passed). In CI the same commit failed on both `smoke (web, 2, 2)` and
`smoke (desktop-shell, 2, 2)` with a 90-second `locator.click` timeout. The call log is the
diagnostic: `locator resolved to <span class="min-w-0 truncate">Id</span>` followed by
`175 × waiting for element to be visible, enabled and stable — element is not visible`. The element
was found every time; it was never clickable.

**Why.** Not established. The viewport is pinned in `playwright.config.ts` (`PINNED_VIEWPORT`) and
is the same in both places, so a plain "CI is narrower" explanation does not hold. What is
established is that the header cell is a `min-w-0 truncate` span inside a column whose width the
dock computes from a measured table width, so it is a span that can legitimately resolve to a
zero-width box while the table around it is perfectly healthy — and the driver then refuses to click
it forever rather than failing fast. The two new smoke tests in the same file that click
`unit-row-<id>` and press keys were unaffected on both runners.

**Cost.** One full CI cycle, about 25 minutes, plus the diagnosis.

**Prevent by.** Do not drive a units-table (or any `truncate`d) **column header** from a smoke test
when the fact it establishes can be read instead. Here the sort existed only to fix which of two
rows was above the other, and reading the order off the rendered rows is both shorter and
independent of the fixture:

```ts
const order = await page
  .getByTestId("panel-units")
  .locator("tbody tr[data-testid]")
  .evaluateAll((found) => found.map((row) => row.getAttribute("data-testid") ?? ""));
```

Concretely, for `skills/plan-bead`: a plan that writes a `thead` click into a walk should say what
the click is *for*, so an implementer can see when the answer is available without it. Two files
already do the same thing (`foreignUnits.spec.ts:126` clicks `Faction`, and this plan cited it as
the shape to copy), so this is a pattern that is spreading rather than a one-off.

**Seen before.** None found for this exact symptom. Adjacent, same family — the driver's answer
about a shape not matching what a person sees: `docs/retrospectives/ah-e4v.md` (an `overflow-hidden`
ancestor clipping paint while `boundingBox()` still reports the full box),
`docs/retrospectives/ah-67h8.md` (`toBeVisible()` on an SVG hairline), and the WebKit-clipped-text
entry already in `.cerebro/traps.md`.
