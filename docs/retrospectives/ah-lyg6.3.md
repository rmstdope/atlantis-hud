# ah-lyg6.3 — retrospective

- **Implementer:** Storm
- **Date:** 2026-09-05
- **PR:** #970

## Five agreed behaviours were built as pure functions and never wired to the interface

**What happened.** `goalsAfterTeach`, `plannerNotices`' `shelters` argument, `hoverCard`'s
`teacherNames`, `cellMenu`'s `label` and the `×1` mark were each written, unit-tested and green —
and each was unreachable from the running application, because the call site never passed the
argument or called the function. `grep -rn goalsAfterTeach packages tests` returned only its own
definition and its own test. The most costly of the five was `goalsAfterTeach`: the popover's `Set`
routed *every* goal through `goalsAfterSet`, which truncates, so a teach month silently wiped the
plan behind it — exactly the I2 the navigator had rejected, shipped behind a green suite that
tested the I1 function nobody called.

**Why.** Every one of the five is a *widening* — a new optional parameter, or a new sibling of an
existing writer. TypeScript cannot fail a call that omits an optional argument, and a unit test of
the new function passes whether or not anything calls it. The plan named all five as interface
changes, so nothing about them was a surprise; what was missing was any check that the wiring
happened.

**Cost.** One full review round (the cold read found all five), about forty minutes of rework, and
two extra CI cycles. Had the reviewer not caught finding 1, the bead would have merged with a
data-losing edit path under a green suite.

**Prevent by.** When a bead's plan adds a parameter to an existing function or a sibling to an
existing writer, `grep` for the new symbol before the PR opens and check that a *non-test* file
calls it. Cheaper still, and what this bead ended up doing: put the choice between two writers in a
pure function of its own (`goalsAfterPick`) and test that, so the routing is something a
jsdom-free package can actually assert — the same move `ah-1mpx.1` records for a store effect
("test the constraint, not the cycle").

**Seen before.** `ah-1mpx.1` — same shape, different layer: a rule proved in a pure test while the
thing that had to obey it was not covered.

## A smoke assertion guarded on its own precondition asserted nothing

**What happened.** The first smoke case wrapped the warnings-strip click, list and focus assertions
in `if ((await toggle.count()) > 0)`. The fixture raised no notice at all, so the entire strip half
of the only case covering the click and the focus move passed having checked nothing — and it
looked green in CI.

**Why.** I could not tell from the fixture whether a notice would be raised, and guarded rather
than finding out. The guard turned an unknown into a silent pass.

**Cost.** Caught by the review rather than by CI; about twenty-five minutes to find a deterministic
scenario, most of it spent discovering that the fixture's mages all hold force 4 and that
`rules/skills_teaching` therefore lets none of them teach another in it.

**Prevent by.** Never guard a smoke assertion on the condition it exists to test. Where the fixture
may not reach the case, arrange the case in the walk — this one now plans a student before teaching
him, and uses a second single-write case for the strip — or leave the assertion out and say so.

**Seen before.** `ah-agbm`, `ah-1wcw.4` and `ah-60w` all record a test that could not fail, in other
forms.
