# ah-m9q.2 — retrospective

- **Implementer:** Storm
- **Date:** 2026-08-15
- **PR:** #255 (original build); this file merges without a new PR of its own, see below

## Verification failed against a build that predated the merge it was checking

**What happened.** Psylocke reopened ah-m9q.2 at P0 because the running web app showed no
Warnings tab at all, with the old "Warn about unguarded hex" checkbox still present in Global.
On picking the bead back up, `git log origin/main --grep "(ah-m9q.2):"` showed the feature had
already merged (581dabc, PR #255) with a full test suite. I rebuilt `apps/web` fresh from current
`origin/main` and ran the three smoke tests that exercise the tab
(`settings-tab-warnings`/`settings-warning-hex-unguarded`/`settings-warning-not-enough-silver`) —
all three passed. I also found `v0.7.0` was released (`eb6bdc4`, 10:52 UTC) *before* ah-m9q.2
merged (`581dabc`, 12:03 UTC). I started a fresh preview server from current main and had the
navigator check it directly: the tab was there and worked exactly as designed.
**Why.** Not established with certainty, but the timing is suggestive: the verification most
plausibly ran against the v0.7.0 release build or a dev server left running from before the merge,
rather than a rebuild of the exact commit that had just landed. No defect was found in the merged
code itself.
**Cost.** One P0 reopen-and-replan cycle, plus this implementer's full pickup-and-diagnose pass
(~40 minutes) that produced no code change — the fix was confirming the existing build, not
building anything.
**Prevent by.** Psylocke's prep step ("prepares everything before she ever asks for your time —
what the bead claimed, which shell to launch") should pin down and record which commit the shell
it launches is actually running, ideally by rebuilding from the exact merge commit rather than
reusing whatever build/server is already up. That is a change to the verifier's own process, so it
is the navigator's call, not mine — recorded here rather than acted on.
**Seen before.** None found.
