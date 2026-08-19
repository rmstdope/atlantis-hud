# ah-87he — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-08-19
- **PR:** #443

## CI ran three times for two commits while the fleet queued behind it

**What happened.** The PR's checks sat in `queued` for about 45 minutes. `gh run list` showed the
backlog was fleet-wide — Storm's `ah-58dz` and Wolverine's `ah-vw63` runs were queued or had been
`in_progress` for two hours — so waiting was the right response and the checks did eventually all
pass. What is worth recording is what my own branch contributed to that queue:

```
completed/success 2026-08-19T09:10:46Z 28cd4c4   # the review fixes
completed/success 2026-08-19T08:52:34Z f723340   # the original push
completed/success 2026-08-19T08:52:19Z f723340   # ...and again, same sha
```

Three full runs for two commits. Two of them were for the **same sha**, 15 seconds apart, and both
ran to completion. The `pwa` job alone takes 21 minutes, so a duplicate run is roughly half an hour
of runner time spent proving something that was already being proved on the same commit.

**Why.** Established for the duplication, not for the double-trigger's exact origin.
`.github/workflows/ci.yml` declares no `concurrency` group — `deploy.yml` is the only workflow in
the repository that has one. Without it GitHub supersedes nothing: two events on one sha produce two
independent runs, and a push that obsoletes an in-flight run leaves that run to finish anyway. On a
single-PR day this is invisible; with four agents pushing it is the queue.

**Cost.** About 45 minutes of wall-clock on this bead, most of it queueing rather than testing. No
code change and no re-run — the checks were green first time.

**Prevent by.** A `concurrency` block in `.github/workflows/ci.yml`, keyed on the ref and cancelling
superseded runs — the shape `deploy.yml:22-24` already uses, but with `cancel-in-progress: true`:

```yaml
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true
```

That collapses the same-sha pair and stops a superseded run holding a runner the fleet is waiting
for. It wants care on one point, which is why this is the navigator's call and not an implementer's:
cancelling in progress on `main` would abandon a run whose green is what a release is cut against,
so the group probably needs to exclude `main` or key on the PR number rather than the bare ref.

Worth weighing against simply adding runners; this is the free half of the fix.

**Seen before.** None found for this. `ah-mjy`, `ah-k6i.5` and `ah-bn6.1` all describe a *single job
hanging and cancelling* (the Playwright dependency install), which is a different failure — those
are about a run that stalls, this is about runs that should never have existed.

## Not recorded: the disk preflight failing in `check:fast`

`pnpm run check:fast` failed on `scripts/diskPreflight.test.ts` with 6 GB free against the 8 GB
floor, `prune-worktrees.sh` reclaimed nothing (three sibling worktrees all held unmerged work), and
the PR was opened with the failure named in its body so CI's own disk could be the real gate.

This is noted here only to say it is **deliberately not a finding**: `ah-quw` records the identical
symptom, cause and response, and a dozen other files mention the same floor. A fifteenth account
would add nothing except one more file between a reader and something they have not seen before.
