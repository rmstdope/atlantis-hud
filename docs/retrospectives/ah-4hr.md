# ah-4hr — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-08-15
- **PR:** #256 (atlantis-hud), #14 (rmstdope/cerebro)

## The empty-queue poll's own example finds a bead it does not claim, and another implementer can take it first

**What happened.** Following `implement-bead`'s *Picking up* section, my empty-queue wait loop used
the pattern the skill itself gives:

```bash
until bd ready --label planned --exclude-label human --exclude-type epic --json \
        | grep -q '"id"'; do
```

— i.e. `bd ready --json` with no `--claim`, just checking that *something* is ready. When it found
`ah-u3i`, I broke out of the loop and moved on to the skill's next step (`bd dolt pull` then a
separate `bd ready --claim` call). In the gap between the poll seeing the bead and the claim call
actually running, another implementer (Storm) claimed `ah-u3i` first — confirmed by `bd show`
returning `status: in_progress, assignee: Storm` when I expected my own name. With three
implementers now routinely running at once, this window is not a corner case; it is closer to a
coin flip on a queue with only one or two ready beads.

**Why.** The two-step pattern — poll for existence, then claim separately — is inherently a
check-then-act race once more than one implementer is polling the same query. `bd ready --claim` is
itself atomic (it did correctly hand the bead to exactly one of us), but the skill's documented
*wait* loop does not use `--claim`, so "found one" and "claimed one" are two different moments an
arbitrary amount of time apart.

**Cost.** About two minutes: one `bd show` call to notice the mismatch, reset my state file back to
`idle`, and resume polling — this time with `--claim` folded directly into the loop's condition
(`bd ready ... --claim --json`), which claims atomically the instant one appears and cannot lose the
race the same way. No worktree or branch was created before I noticed, so nothing needed cleaning up.

**Prevent by.** `implement-bead`'s *Picking up* section could fold `--claim` into the wait loop
itself, exactly as I did the second time, rather than presenting "wait for one to exist" and "claim
one" as separate steps — collapsing the TOCTOU window entirely rather than relying on each
implementer to notice a claim can be lost between the two calls. Out of scope for me to change here
(the skill is the navigator's to edit), so recording it as a finding.

**Seen before.** none found (distinct from ah-3cs, which is about worktree reuse *after* a
successful claim, not the poll-then-claim gap before one).
