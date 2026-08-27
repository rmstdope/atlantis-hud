# ah-gjbs.1 — retrospective

- **Implementer:** Wolverine
- **Date:** 2026-08-27
- **PR:** #745

## The project traps file now exists, and the eight-times-recorded local smoke failure is still not in it

**What happened.** The full local `pnpm run test:smoke` reported 542 passed and one failure:
`workspace.spec.ts › the faction view uses the window before it scrolls`, on both `web` and
`desktop-shell` (`toBeInViewport`, viewport ratio 0). This bead touches the unit pane and a new
dialog, not the faction panel, so I established it was not mine the way the previous seven did:
`git stash push -u`, run the single spec, watch it fail identically, `git stash pop`. CI on `main`
was green on its five most recent runs.

**Why.** Established for the *symptom* — the failure is independent of this branch's diff and local
to this machine. The underlying cause is still unestablished after eight sightings; the assertion
depends on the last attitude row fitting a 720px-tall window, so it is sensitive to whatever makes
this machine's rows taller than the runner's, but nobody has proved that.

**Cost.** About fifteen minutes: the stash-and-verify cycle, plus a full extra smoke run and the
judgement call about entering the merge with a red local suite.

**Prevent by.** This is the part that is new, and it is why an eighth file is worth writing rather
than being noise. `ah-bkjd.md` (which I wrote, four sightings ago) asked for exactly one of two
things: quarantine the spec, or "name it in a project traps file as known-red locally and green in
CI — a project traps file is exactly where a fact like this belongs, and **this repository has
none**." That file now exists — `.cerebro/traps.md`, tracked, with five entries — and this fact is
not among them. So the prevention four retrospectives asked for arrived, and the finding it was
meant to carry was never moved into it. The concrete change: add one line to `.cerebro/traps.md`
saying that `workspace.spec.ts › the faction view uses the window before it scrolls` is known-red on
some local machines and green in CI, so the next implementer reads it instead of re-deriving it.
That is a curated file the navigator owns, which is why this is recorded rather than done.

**Seen before.** `ah-bkjd.md`, `ah-9ess.md`, `ah-brgo.1.md`, `ah-brgo.1-reopened.md`, `ah-2a96.md`,
`ah-o2li.md`, `ah-z31p.md` — seven files naming the same spec. This is the eighth.

## A plan that adds a keyboard shortcut still did not name `navigationGuide.ts`

**What happened.** With the F3 chord wired and every named test green, `pnpm run check:fast` failed
its `test` leg on a file the plan never mentions:

    packages/shared/src/navigationGuide.test.ts
    × NAVIGATION_MOVES > spells the global chords exactly as the dispatch table does
      → no move for the magicTree shortcut: expected undefined to be defined

**Why.** Two tables stand behind the help overlay. `SHORTCUTS` (`shortcuts.ts`) holds the chords;
`NAVIGATION_MOVES` (`navigationGuide.ts`) holds the guide's prose and reads its keys back out of
`SHORTCUTS`. A test pins that every shortcut id has a matching move, so a new id in the first table
is a hard failure until it is added to the second. This bead's plan named `shortcuts.ts` and
`AppShell.tsx` precisely, down to line numbers, and is silent about `navigationGuide.ts` — which
reads as reassurance that `SHORTCUTS` was the whole story.

**Cost.** Small: one failed gate leg and about five minutes to read the failure and add six lines.
Recorded because it is the second occurrence of a mechanical, certain trap whose stated prevention
has not taken.

**Prevent by.** `ah-u44o.md` already wrote the prevention and it did not reach this plan, so
repeating it as prose is unlikely to work a third time. The version worth acting on is structural: a
planner's checklist item, or a line in `.cerebro/traps.md`, saying **a new `ShortcutId` needs a row
in `SHORTCUTS`, a move in `NAVIGATION_MOVES`, and the suite enforces both.** Both are the
navigator's to change.

**Seen before.** `ah-u44o.md` — same test, same cause, same missing file in the plan.
