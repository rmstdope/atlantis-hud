# ah-zh5i.1 — retrospective

- **Implementer:** Storm
- **Date:** 2026-08-27
- **PR:** #751

## The plan's predicted RED for increment 2 never happened, and the increment looked unnecessary

**What happened.** The plan's increment 1 said that after renaming the colliding testid, "the rest
of the spec still fails, on `toBeInViewport` — expected at this stage", and increment 2 opened with
"Before rewriting, confirm the old shape still fails — it does, on `toBeInViewport`, and that is the
failure this increment closes."

It did not fail. After the rename,
`SMOKE_PROJECT=web pnpm exec playwright test tests/smoke/workspace.spec.ts --project=web -g "the
faction view uses the window before it scrolls"` was green, and stayed green on both projects. So at
the start of increment 2 — the increment carrying the whole point of the bead, making the assertion
font-independent — there was no failing test to drive it, and the honest reading of the runner's
output was "this bead is already done".

**Why.** Established. `toBeInViewport()` defaults to `ratio: 0`, i.e. *any* part of the element
visible. The plan's own measurements table gives the last attitude row
(`faction-attitude-Ally`) as top 550, bottom 725 in a 720px window: clipped at the bottom, but its
top half plainly on screen, so the assertion passes. The plan derived its prediction from the
measurements of the *name span* (`faction-attitude-name-73`, top 708, bottom 723 — entirely below
the popover's 688 edge, ratio 0), which is what the locator resolved to *before* the rename. The
rename changed which element was measured, and the prediction was not re-derived for the new one.

**Cost.** About ten minutes, and a decision that should not have been an implementer's to make: with
no RED available as written, I had to construct one. I used the plan's own increment-3 mutation
table — setting `POPOVER_BODY_MAX_H = "max-h-[624px]"`, a hard-coded pixel cap of exactly the kind
ah-cp8 removed, and showing the old spec passed it. That is a stronger demonstration than the one
the plan asked for, and the rewritten spec fails it. But the cheaper wrong turn was available and
inviting: a green test at the top of increment 2 reads as permission to skip the rewrite, ship the
rename alone, and leave the font dependence — the actual defect, and the reason nine retrospectives
name this spec — in place.

**Prevent by.** When a plan predicts an intermediate RED, it should name the assertion *and the
value it will report*, the way this plan's increment 1 correctly did (`Expected:
"faction-attitude-Ally" / Received: "faction-attitude-name-73"` — which is exactly what appeared).
A prediction stated as a bare assertion name cannot be checked against the measurements it was
derived from, and this one silently carried a measurement of a different element across a step that
changed the element. Concretely, for `plan-bead`: where an increment changes *which* element a
locator resolves to, any later prediction about that locator is re-derived, not inherited. And where
a plan already contains a mutation table, it is worth saying that the mutation is the fallback RED if
the predicted one does not appear — that turns a stall into a step.

**Seen before.** `ah-uwa3` — same class: the plan predicted a specific test outcome ("no finding
count may move") from a reading of the fixture that was wrong, and the implementer had to establish
what was actually true before it could tell a defect from a correct change.
