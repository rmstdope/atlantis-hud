# ah-1mpx.2 — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-08-27
- **PR:** #748

## A control added to a pane's header slot broke a CSS selector, and only CI said so

**What happened.** The bead puts an `Add to army ▾` button in the units pane's `actions` slot, which
is a settled navigator decision (T1). `tests/smoke/persistence.spec.ts:200` selects the pane's fold
toggle as `page.locator('[data-testid="panel-units"] header button')` — one match until now, two
afterwards. `smoke (web, 1, 2)` and `smoke (desktop-shell, 1, 2)` both failed with
`strict mode violation: … resolved to 2 elements`. `pnpm run check:fast` was green throughout, and
so were the six new walks in `tests/smoke/armies.spec.ts` and all 159 of `workspace.spec.ts`, which
is where I had looked.

I *had* followed `implement-bead`'s accessible-name trap and grepped the suite for the words of
every name I added. That finds nothing here: the colliding selector names neither a testid nor a
role nor any word of the new control. It names a tag.

**Why.** Established. `header button` scoped to a container is a selector whose meaning depends on
that container holding exactly one button, and the pane header is a *slot* — its whole purpose is
that panes put controls in it. Nothing records that assumption anywhere a change to the slot can
see.

**Cost.** One full CI cycle (~6 minutes of runners across five jobs), plus one local control run
against `origin/main` to establish that the *other* red test was not mine. The fix is one selector.

**Prevent by.** `ah-bu2c` below already asked `implement-bead` to say "grep for role-only selectors
scoped to a row, cell or list item". That wording would not have caught this one twice over: this is
a **CSS tag selector**, not a role selector, and the container is a **pane header slot**, not a row.
The rule that covers both sightings is broader and worth stating as such: **before adding any
interactive element to a container other code selects within, grep the suite for every
container-scoped selector that does not name a specific control** — role-only, tag-only, or
`:nth-child`. For this repository that is one command:

```bash
grep -rnE 'getByRole\("button"\)|locator\([^)]*\b(header|footer|thead|tbody) [a-z]+' tests/
```

Run against this bead's diff it returns exactly the one line that broke.

**Seen before.** `docs/retrospectives/ah-bu2c.md` — same class (a new control making an existing
container-scoped selector ambiguous, caught only by CI), one bead and one week earlier, in a table
row rather than a pane header. Second sighting.

## A smoke test that fails locally and passes in CI cost a control run to disprove

**What happened.** `tests/smoke/workspace.spec.ts:4297`, `the faction view uses the window before it
scrolls`, fails on this machine — `expect(lastAttitudeRow).toBeInViewport()` times out — while the
same job is green in CI. It is a viewport-sensitive assertion (`≤ 720`) about a header popover with
no relationship to this bead's diff.

**Why.** Not established. It reproduces on `origin/main` in this checkout with nothing of mine
applied, so it is not caused by this bead; whether it is display scaling, a font metric or something
else about this machine I did not chase.

**Cost.** About four minutes: detaching to `origin/main`, rebuilding the web bundle and running the
one test to prove it was pre-existing rather than mine.

**Prevent by.** A local-only failure in a shared suite is a tax on every implementer who runs it,
and each of us pays it by rediscovery. Somewhere a reader will look — `.cerebro/traps.md`, which
already carries facts of exactly this shape — should name the test and say it is known to fail
locally and pass in CI, so the next implementer reads one line instead of running a control build.
That file is curated by the navigator through Forge, which is the right route for this.

**Seen before.** None found: `docs/retrospectives/` has several findings about a check that passed
locally and failed in CI, and none about the reverse.
