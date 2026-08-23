# ah-brgo.1 (reopened) — retrospective

- **Implementer:** Storm
- **Date:** 2026-08-23
- **PR:** #582

*Filed under a suffixed name because `docs/retrospectives/ah-brgo.1.md` already holds the original
run's retrospective, and the format says a retrospective is never rewritten. This is the same gap
`ah-0w7w-reopened.md` named a day earlier: a bead reopened by verification is built twice, and
one-file-per-bead has no room for the second run. Second sighting; still not mine to fix.*

## The smoke helper written for the feature could not have caught the feature's bug

**What happened.** The original `ah-brgo.1` shipped with two browser tests whose job was to prove
the map never runs out — `panning east forever stays on the map` and its westward twin. Both call
`expectWorldUnderTheView`, which asserts that *some* copy of the world is drawn within half a period
of the screen's **centre**. The navigator then found a band of emptiness on the right-hand edge when
zoomed far out. Both tests were green throughout, on `origin/main`, while the bug was live.

**Why.** Established, and it is arithmetic rather than opinion. A copy near the centre says nothing
about the edges once the screen is wider than one repeat — and "wider than one repeat" is precisely
the condition zooming out creates. The helper's assertion is scale-invariant in exactly the way the
bug is not, so no amount of panning at any zoom would have failed it. The verification note reached
the same place from the other end: the copies were placed around `tx`, and the visible rectangle is
not symmetric about `tx`.

**Cost.** None to this run — the note's lead was accurate and the fix was quick. The cost was paid
by the previous run and by the navigator's verification sitting: a bead built, reviewed, merged and
then reopened at P0 for a defect its own regression tests were shaped not to see.

**Prevent by.** When a plan's test asserts that something is *visible*, make the assertion name the
region it must be visible across, not a point it must be visible near. Concretely, in
`implement-bead`'s *Traps this fleet has already paid for*: a viewport assertion that checks the
centre passes for every failure that only affects an edge, and zoom is the control that turns one
into the other. This run's `expectWorldAcrossTheView` is the edge-to-edge form of the same helper
and is what a plan of this kind should ask for from the start.

**Seen before.** None found for this specific shape. `ah-0w7w-reopened.md` is the nearest neighbour
in kind — a verification failure in the same map surface — but its cause was unrelated.

## Two smoke specs fail on this machine and pass in CI

**What happened.** `pnpm run test:smoke tests/smoke/workspace.spec.ts --project=web` failed twice
locally, reproducibly and not as a flake, on `a planned route can be written into the unit's orders`
(`:2193`) and `the faction view uses the window before it scrolls` (`:4122`). Neither is anywhere
near this bead. I stashed every change in the branch, re-ran both at the merge base, and they failed
identically — so they were not mine. CI then ran all four smoke shards on this branch and **passed
every one of them, including both of those specs**.

**Why.** Not established. The specs pass in CI's runner and fail on this machine, so it is something
environmental — window size, fonts, or timing — rather than the code. I did not investigate further
once I had shown they were neither mine nor red on main; diagnosing them is not this bead's scope.

**Cost.** About twenty minutes: two confirmation runs of the failing pair, plus a full stash-and-run
of the suite at the merge base to establish they pre-dated the branch. The full web suite is ~6
minutes a pass.

**Prevent by.** Worth someone establishing whether these two are known local-only failures. If they
are, they belong in `.claude/cerebro-traps.md` by name, so the next implementer who sees them reads
one line instead of spending a baseline run proving a negative. If they are not, they are a genuine
local/CI divergence in the smoke suite and want a bead. Either way the decision is the navigator's.

**Seen before.** `ah-j2w.md`, `ah-9js.md`, `ah-djq.md` and others record the opposite direction —
green locally, red in CI. This is the first in this directory recording red locally and green in CI,
which is the more misleading of the two: it invites an implementer to "fix" something that is not
broken.
