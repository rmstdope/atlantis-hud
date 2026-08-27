# ah-wwyr — retrospective

- **Implementer:** Wolverine
- **Date:** 2026-08-26
- **PR:** #740

## The plan's own validation snippet silently "failed" under the implementer's default shell

**What happened.** The bead's Validation section gives a copy-paste snippet that sets
`GENERATED="dir1 dir2"` unquoted and passes it to `git status --porcelain -- $GENERATED`, expecting
bash's default word-splitting to turn it into two pathspecs. Run verbatim in this session's
interactive shell it printed `NOT CAUGHT` and a `git`
`warning: could not open directory 'packages/core-client/src/generated packages/ruleset/src/'` —
which reads exactly like the widened check not working, when the check itself (added to `ci.yml`,
which GitHub Actions runs under bash) was already correct.

**Why.** The Bash tool's shell here is zsh (confirmed with `echo $0`), and zsh does not
word-split an unquoted variable expansion by default the way bash does — `set -- $GENERATED; echo
$#` printed `1`, not `2`. Wrapping the same snippet in `bash -c '...'` reproduced the intended
`caught` result immediately.

**Cost.** About 10 minutes and three extra tool calls (`xxd`, `set --`, checking `$IFS`) to tell a
shell difference apart from an actual defect in the change under test.

**Prevent by.** A plan (or this skill) that hands over a validation snippet relying on unquoted
multi-word variable expansion for pathspec-style word-splitting should either quote it as an array
(`GENERATED=(dir1 dir2)` is also zsh/bash-incompatible, so this doesn't fully solve it either) or
say explicitly to run it via `bash -c '...'` — since an implementer's interactive shell is not
guaranteed to be bash, and the failure mode (a `git` warning plus a wrong-looking answer) looks
exactly like the code under test being broken.

**Seen before.** None found.

## CI on the PR's first head stayed queued for over 20 hours from a GitHub Actions incident, and needed a manual retrigger

**What happened.** After the review and the retrospective commit, `gh pr checks 740` reported "no
checks reported" for the pushed head, and the workflow run itself (`32984013844`, created
2026-08-26T15:05:00Z) sat at `status: queued` indefinitely — still queued when checked again the
next day (`2026-08-27`), with `gh run cancel`/`POST .../cancel` both refusing it
("Cannot cancel a workflow run that has not been queued yet." on a run whose own `status` field
read `queued`). A second, unrelated PR's run from the same window (`32984753781`, branch
`ah-bxgs-transport-distribute-items-column`) was stuck the same way.

**Why.** `githubstatus.com` records an Actions incident for exactly this window: "Actions jobs
failed to start" 15:02-17:40 UTC on 2026-08-26, caused by database saturation and an
upstream event-processing issue, with some jobs "remained stuck in a queued state and required
forced cancellation around 18:40 UTC." This run was created at 15:05 UTC, inside the incident, and
was never one of the ones GitHub force-cancelled.

**Cost.** The run sat stuck long enough to span a date change in this session (per the environment's
own date-change notice) before being noticed and acted on — call it most of a day of wall-clock,
though the session itself was not continuously polling it throughout. Fixed in under a minute once
diagnosed: an empty commit (`git commit --allow-empty`) pushed to the branch started a fresh run
(`33080302014`) under the same `${{ github.workflow }}-${{ github.ref }}` concurrency group, which
completed normally in about 5.5 minutes with all 11 checks green.

**Prevent by.** When a PR's checks read "no checks reported" or a run's `status` stays `queued` well
past this project's normal ~5-6 minute CI time, check `githubstatus.com` for an Actions incident
before assuming the change or the wait loop is at fault. If a genuine incident matches the run's
creation time and cancelling it via the API is refused, `git commit --allow-empty` and push is the
recovery — no code change needed, and the existing concurrency group picks up the fresh run without
any extra configuration.

**Seen before.** None found.
