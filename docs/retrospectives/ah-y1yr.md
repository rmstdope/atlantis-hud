# ah-y1yr — retrospective

- **Implementer:** Storm
- **Date:** 2026-10-08
- **PR:** #1443

## A refactoring bead and the bug it names were being built at the same time, in the same files

**What happened.** ah-y1yr's description (filed by Forge) says the refactoring makes ah-r3rv's
formed-unit case "fall out". When I was assigned ah-y1yr, Bishop already held ah-r3rv
(`in_progress`, building) and was changing the same `OrderedUnits::with_settled_teachers` that
ah-y1yr removes. There was no dependency edge between the two beads, so the fleet view handed both
out at once.

**Why.** Forge writes the relationship into the description as prose. It does not add it as a
`bd dep add` edge, and `scripts/assignable-beads` reads only edges.

**Cost.** I messaged Bishop so its fix would land where my refactor expected it. Then I waited
about 25 minutes, heartbeating, for #1440 to merge. The rebase had three conflicting files. Without
the message, one of the two PRs would have redone the other's design.

**Prevent by.** When Forge files a `Refactoring:` bead that names an open bead it would absorb or
reshape, it adds `bd dep add <refactoring> <named bead>` (Forge's agent definition, the step that
files findings). The refactoring then reaches a producer only after the named bead has closed.

**Seen before.** none found

## A RED shown before the rebase was reported as RED against the PR's base

**What happened.** I proved `a_formed_passenger_of_a_sail_an_eligible_teach_replaced_is_not_traced`
red by restoring the pre-refactor source on top of the old base. Then I rebased onto ah-r3rv,
whose own guard change already made that test pass. The PR body still said the test was "red
against the code before the refactor". The review sub-agent ran it on the real base and found it
green (finding 1).

**Why.** The RED was shown before the rebase and never shown again afterwards.

**Cost.** One review finding, plus corrections to the PR body and the plan.

**Prevent by.** After any rebase that brings in a commit touching the same functions, show the RED
again against the new base before quoting it in the PR body (`produce-bead`, *Merging*: the
rebase step). If it no longer fails, call the test a regression pin.

**Seen before.** ah-tdsi (a cleanly merged rebase left tests asserting behaviour the merged bead
had just changed).
