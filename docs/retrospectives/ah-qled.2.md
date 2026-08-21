# ah-qled.2 — retrospective

- **Implementer:** Storm
- **Date:** 2026-08-21
- **PR:** rmstdope/cerebro#74, and the pin bump here

## A sibling bead in the same epic created the same new test file, mid-flight

**What happened.** The plan's increment 1 said "RED: `tests/` — a fabricated consumer with no
lockfile and no `install` key". I wrote `tests/prepare-worktree.sh`, since no such suite existed at
`89f11e2`. While the Copilot review was outstanding, **ah-qled.3 merged as cerebro#73 and created a
file of that exact name**, for its own reasons (branch resolution). Catching up produced an
`add/add` conflict on the test and a content conflict on `scripts/prepare-worktree`, whose install
step ah-qled.3 had also touched.

**Why.** Established. Both beads are children of `ah-qled` and both change
`scripts/prepare-worktree`; neither plan mentions the other, and neither names the test file it
intends to add. `bd show` gives the plan but nothing about what a sibling in flight is writing.

**Cost.** About twenty minutes: a two-file conflict resolution, re-applying the whole script change
onto ah-qled.3's version by hand rather than accepting a merge, and renaming my suite to
`tests/prepare-worktree-install.sh` so both survive. One CI cycle after the force-push.

**Prevent by.** A plan whose increment adds a **new file** should name the file, and a plan for a
child of an epic whose siblings touch the same script should say so — `plan-bead`'s *Files to
change* section is where that belongs. ah-qled.2's own plan does coordinate on a *key* ("ah-qled.7.1
wants the same key … coordinate, do not duplicate"), which shows the planner is already thinking
about sibling collisions; it did not extend that to the test file or to the script both beads edit.
Concretely: name the new test file in the plan, and `git log origin/main --oneline -10` before
opening the PR when the bead is one of several children of a live epic.

**Seen before.** None found for this shape. `docs/retrospectives/ah-qled.3.md` is the other side of
the same collision but records a different finding (macOS `mktemp -d` paths), and no existing file
describes two siblings creating the same path.
