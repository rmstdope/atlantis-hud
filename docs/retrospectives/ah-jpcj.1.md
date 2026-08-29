# ah-jpcj.1 — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-08-29
- **PR:** #797

## A workspace invariant held only by three comments was broken by a plan that never mentioned it

**What happened.** `AppShell.tsx` keeps three independent pieces of state for the three questions a
dropped file can raise — `pendingLoad`, `pendingOrdersImport` and, as of this bead,
`pendingMapExport` — and the rule that only one is ever on screen is stated in a comment beside the
state declaration (`"The two clear each other on arrival: only one question is ever on screen at a
time."`) and enforced by each site remembering to clear its siblings. The plan for this bead
specified the new prompt in detail — its component, its copy, its test ids, its focus behaviour —
and said nothing about the invariant. I added the third prompt clearing one sibling and not the
other, and neither of the two existing sites was updated to clear the new one, so a question left
open plus a second file dropped showed both prompts stacked, each with its own document-level
Escape handler. A game switch left the new prompt open too, holding a faction id and a turn
belonging to the database being left — the exact case the comment three lines above that code warns
about. Nothing in the fast gate or the smoke suite failed. The Copilot reviewer found it, named all
three sites, and was right about every one.

**Why.** The invariant lives in prose beside the state rather than in anything that fails when it is
broken. There is no helper that closes the others, and no test that drops two files in a row — so
its only enforcement is that whoever adds a fourth prompt reads a comment on an unrelated
declaration. This bead's plan is not unusual in omitting it; nothing would have told the planner it
existed.

**Cost.** One review round and one CI cycle, about twenty minutes. It did not ship, because the
reviewer caught it — the cost of the version where it does ship is a stacked prompt writing a merge
into the wrong game.

**Prevent by.** Making the invariant fail rather than be remembered: one `closeFileQuestions()`
helper that every site calls before setting its own state, so adding a fourth prompt is one edit in
one place rather than three edits nobody is prompted to make. Failing that, a smoke walk that drops
two different kinds of file in succession — this bead now carries one for the map-export pair
(`tests/smoke/map-export.spec.ts`, "a map export replaces a question already on screen"), but the
foreign-report/orders-import pair still has none. Either is a change outside a planned bead, so it
is recorded here rather than made.

**Seen before.** None found — `grep -rl "pendingLoad" docs/retrospectives/` returns nothing.

## The plan described focus behaviour the component it cited does not have

**What happened.** The plan said to copy `ForeignReportPrompt.tsx` and that focus should move to the
confirm button on open and back to Import on close, "matching what the foreign-report prompt does".
That component manages no focus at all: it has no ref, no autofocus and no restore, and nothing in
the smoke suite asserts focus for it. I built the behaviour rather than copied it.

**Why.** The plan's *Validation* section also asks a person to check that focus lands on **Add to
map**, so the intent was unambiguous even though the cited precedent was wrong. Reading the file
before building on it is what caught it — the skill's rule about a helper a plan cites for what it
decides, applied to a component.

**Cost.** A few minutes, and one paragraph in the PR body recording the deviation.

**Prevent by.** Nothing structural; this is the "read the thing the plan cites before building on
it" rule working as intended, and it is already written in `implement-bead`'s *When the plan is
wrong*. Recorded only because the same sentence would send a less careful reader to copy a component
that does not do what it is said to do — a planner writing "matching what X does" is making a claim
about X worth checking at plan time.

**Seen before.** None found.
