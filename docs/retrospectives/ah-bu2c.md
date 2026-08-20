# ah-bu2c — retrospective

- **Implementer:** Storm
- **Date:** 2026-08-20
- **PR:** #478

## Adding a control inside a units-table row broke six smoke helpers, and only CI said so

**What happened.** The bead puts a faction name inside a units-table cell as a `<button>`. Six smoke
helpers select a unit with `row.getByRole("button").click()`, which had exactly one match per row
and now has two on a foreign unit's row. CI's `smoke (web, 1, 2)`, `smoke (web, 2, 2)` and
`smoke (desktop-shell, 2, 2)` failed with `strict mode violation: … resolved to 2 elements` across
five tests in `workspace.spec.ts` and `shortcuts.spec.ts`.

I had grepped for the *labels and testids* the plan named, which is what `implement-bead`'s trap
list asks for, and found nothing — these helpers name neither. They select by role, and a role-only
selector is invisible to a grep for the thing being changed.

**Why.** Established. A bare `getByRole("button")` scoped to a container is a selector whose meaning
depends on the container holding exactly one button, and nothing records that assumption where a
change to the container can see it.

**Cost.** Two CI cycles (~9 minutes of runners) and one more of my own. The fix is one named
selector per helper.

**Prevent by.** `implement-bead`'s *Traps* section already says to grep for every selector naming a
control being moved. It should also say: **when adding an interactive element inside an existing
row, cell or list item, grep for role-only selectors scoped to it** — here
`grep -rn 'getByRole("button")' tests/` finds all six in one command, and would have made this part
of the red bar rather than of CI.

**Seen before.** None found — `docs/retrospectives/` has no other finding about a container-scoped
role selector. The nearest relative is the atlantis-hud #128 note already in `implement-bead` about
grepping for a moved control's selectors, which this extends to controls that are *added*.

## A blanket edit across six files assumed a variable name that one of them did not have

**What happened.** Fixing the above, I applied the same replacement to six spec files with one
script, writing `` name: `unit ${unitId}` ``. `backup.spec.ts` holds its id in `OWN_UNIT`, so that
file referenced an undeclared variable. `pnpm run check:fast` passed — the smoke specs are not in
its typecheck — and CI failed with `ReferenceError: unitId is not defined` in five backup tests.

**Why.** Established: a scripted replacement across files whose local scopes I had not read, and a
gate that does not typecheck `tests/smoke/`.

**Cost.** One CI cycle, about six minutes.

**Prevent by.** After a scripted multi-file edit, print each edited line with its surrounding scope
and read them (`grep -n '<the new text>' -B12 <files>`) instead of trusting the replacement count —
or make the edit one file at a time when the replacement interpolates a local name. Worth noting
separately that `check:fast` typechecks neither `tests/smoke/` nor `tests/native/`, so a spec that
does not compile reaches CI intact; whether that should change is the navigator's call.

## A mutation check passed and still proved nothing, because the panel opened under the pointer

**What happened.** The plan's `reopening after dismissal draws no ring` test guards the Copilot #398
scar. It went green on the correct code, and green *again* with `AppShell`'s forgetting effect
deleted — so it was worthless. The panel opens beside the name clicked, which puts it under the
pointer: reopening with the mouse hovered whichever row landed there and drew a ring for an
unrelated reason, and the `page.mouse.move(4, 4)` I had added to settle that also cleared the stale
hover the test exists to catch. Reopening from the keyboard, with the pointer parked away, made it
fail deterministically under the same mutation.

**Why.** Established by mutation, in both directions.

**Cost.** Perhaps twenty minutes, all of it before the PR — and it would otherwise have shipped a
test that could never fail.

**Prevent by.** Mutation-check every test written to guard a named scar, and when the mutation does
not fail it, treat the *test* as the defect. This one is already in `test-driven-development`
("a brand-new test that passes on its first run has not been shown to discriminate"); what this run
adds is that an interaction test's own setup — where the pointer is — can be the thing that hides
the bug, so it is worth asking what the pointer is doing at each assertion in a hover-sensitive
test.
