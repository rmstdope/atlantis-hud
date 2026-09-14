# ah-z3h3.2 — retrospective

- **Implementer:** Storm
- **Date:** 2026-09-14
- **PR:** #1253

## Posting the review sub-agent's findings was refused as self-approval

**What happened.** The cold-read `reviewer` sub-agent came back with *No findings.* The skill's
*Posting it* step writes the review to a file, then posts it with
`gh pr comment 1253 --body-file /tmp/.../review-ah-z3h3.2.md` and
`bd update ah-z3h3.2 --append-notes "$(cat ...)"`. The harness's auto-mode classifier refused that
Bash call with "Permission for this action was denied by the Claude Code auto mode classifier.
Reason: [Self-Approval]". The same call also switched the state to `ci`, so the refusal blocked
that too. The navigator had to answer an `AskUserQuestion` before the identical post (without the
state change) went through.

**Why.** Not established. A plausible cause is that the classifier reads an implementer posting a
clean review of its own PR, right before a merge, as approving its own work. It has no way to see
that `CLAUDE.md`'s Four Eye Principle and `implement-bead` make that exact step the documented second
pair of eyes.

**Cost.** One question to the navigator and a stall of a few minutes with the bead in `asking`. An
unattended fleet would have sat until somebody answered.

**Prevent by.** The harness settings (`.claude/settings.json`, via `update-config`) could add a
permission rule for the review-posting step, e.g. `gh pr comment` with `--body-file` under the
scratchpad. Alternatively, `implement-bead`'s *Posting it* could keep that call to the post alone
and write state in a separate call, so a refusal does not also take the phase write with it. Which
of these to do is the navigator's decision.

**Seen before.** None found. Other retrospectives (`ah-udff`, `ah-djq`, `ah-y3j1`) record the
classifier refusing `rm -rf` or writes outside the repository, not the review post.

## The plan's validation grep cannot print nothing

**What happened.** The plan's *Validation* grep for leftover defaults includes the pattern
`OrderCommentSyntax = "origins"`. On a correct tree that pattern still matches
`packages/shared/src/rulesets.ts:98`, the type declaration
`export type OrderCommentSyntax = "origins" | "trident";`. My conditional commit, which required
the grep to print nothing, therefore refused to commit a green increment 5. The review sub-agent
flagged the same false positive.

**Why.** The pattern was written to catch `syntax: OrderCommentSyntax = "origins"`, but it is not
anchored to a parameter, so it also matches the type alias.

**Cost.** One extra commit call, a few minutes.

**Prevent by.** In `plan-bead`, a grep offered as "must print nothing" should be run against the
planner's own probe tree before it is filed. Here that probe tree already existed (the plan says it
compiled the guard in one).

**Seen before.** None found.
