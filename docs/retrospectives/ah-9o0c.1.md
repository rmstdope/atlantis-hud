# ah-9o0c.1 — retrospective

- **Implementer:** Rogue
- **Date:** 2026-09-05
- **PR:** #959

## `bd create -p 4 --parent` reported P4 and stored P1

**What happened.** The review found a fifth leaking map outside the plan's scope; the navigator
chose to file it as a child bead. I ran

```
bd create --parent ah-9o0c -p 4 -t bug --title "UpkeepSettlement leaks step-7 …"
```

and bd printed `✓ Created issue: ah-9o0c.3 … Priority: P4`. The bead was actually stored at **P1**,
inherited from its parent — `bd show ah-9o0c.3 --json` reads `"priority": 1`. I reported "filed at
P4" to the navigator and on the PR on the strength of the printed line, and the next review round
caught the mismatch as a finding.

**Why.** `bd create --parent` appears to apply the parent's priority after parsing `-p`, while the
confirmation line is rendered from the requested value rather than the stored one. Not established
beyond that — I did not read bd's source.

**Cost.** Small in time — one review finding and two corrections — but the failure mode is the
expensive part: an unranked bead silently entering the queue at the top of the fleet's priority
order, or a P0-adjacent one silently demoted, with the confirmation line agreeing with whichever
you asked for.

Worth noting the stored value here was the *correct* one: the root `CLAUDE.md` says a child of a
split parent takes its parent's priority and keeps it, so `-p 4` was my mistake and bd's inherit
was right. That is exactly why it went unnoticed — the wrong report and the right behaviour
cancelled out until a reviewer looked at the bead.

**Prevent by.** Two things, either of which would have caught it:

1. `beads-workflow`'s bead-creation section should say that `--parent` overrides `-p`, and that the
   `Priority:` line `bd create` prints is the requested value rather than the stored one — so the
   only way to know a bead's priority is `bd show <id> --json`.
2. `implement-bead`'s *Asking instead of handing back* could add one line: when an answer results
   in a bead being created, read it back with `bd show --json` before reporting what was filed.
   Any `bd create` whose result is quoted to the navigator or onto a PR is worth reading back.

**Seen before.** None found — `grep -rn "bd create" docs/retrospectives/` matches nothing, and no
existing retrospective mentions a priority mismatch.
