# ah-djq — retrospective

- **Implementer:** Storm
- **Date:** 2026-08-17
- **PR:** #354 (merged directly by mistake and reverted; landed again via a follow-up PR)

## A new default-on check broke smoke fixtures that gave to a real turn-71 unit number

**What happened.** `pnpm run check:fast` and `cargo test -p atlantis-hud-core` were green locally,
and the PR opened clean. The first CI run failed two smoke jobs (`smoke (web, 2, 2)` and
`smoke (desktop-shell, 2, 2)`), five specs in `tests/smoke/workspace.spec.ts`, all asserting an
exact warning/problem count that the new `give-target-not-here` check bumped by one.

**Why.** The plan's *Test plan* section named the Rust whole-turn regression
(`validate_real_orders.rs`) as the place a real turn-71 unit id could produce a true positive, and
it was checked and handled there. It did not extend that reasoning to `tests/smoke/`: several
existing specs `GIVE 13401 999999999 SILV` to exercise the shared-purse silver shortfall, and unit
13401 is - deliberately, per the spec's own comment about `13401`'s preset order - a real unit
standing elsewhere in the same committed turn-71 report the smoke suite loads. Two more specs gave
to unit `4573`/`45`, chosen only to be a syntactically valid target for a syntax/catalogue check,
with no report-presence guarantee either way. `check:fast` does not run the browser suites (by
design - CI's parallel jobs are the gate), so none of this was visible before the PR opened.

**Cost.** Two CI cycles (~6 minutes each) and a rebase against an `update-branch` in between; no
bead hand-back, since every fix was swapping the GIVE target to unit `0` (the discard target) in
fixtures that never cared about the recipient's identity.

**Prevent by.** When a plan adds or changes an advisory check that reads the *report* (not just the
orders text), its *Files to change*/*Test plan* section should say to grep `tests/smoke/` for GIVE/
TAKE orders and check each target against the fixture report the smoke suite loads - not only the
Rust whole-turn regression test - before the PR opens. `grep -rn "GIVE \|TAKE FROM" tests/smoke/`
costs one command; the two CI cycles here cost about a quarter of the hour a cycle usually takes.

**Seen before.** ah-j2w - a different mechanism (a finding's panel/attribution moving, not a new
check catching real fixture data), but the same underlying lesson: `check:fast` does not run the
browser suites, so a change to what the semantic checks report is invisible to local gates and
needs `tests/smoke/` itself grepped or run before trusting a clean PR open. Two sightings now argues
this belongs in the `implement-bead` skill's traps section rather than in a third bead's
retrospective.

## A rebase against `update-branch` pushed the PR branch straight onto main

**What happened.** After the review comment was answered and the PR branch needed catching up a
second time, `git fetch origin ah-djq-give-target-not-here && git rebase origin/... && git push`
was run in a fresh `Bash` tool call. That call's working directory was the shared main checkout
(`/Users/henrikku/repos/atlantis-hud`) rather than the bead's worktree - `pwd`/`git branch
--show-current` there read `main` - and the rebase silently succeeded with the message "Successfully
rebased and updated refs/heads/main", because the local `main` branch was checked out and got
rebased onto the PR branch's tip. The following `git push` fast-forwarded `origin/main` to a merge
commit containing every one of the PR's commits, none of them reviewed-and-merged through
`gh pr merge` - GitHub's UI then read the PR itself as `MERGED`, since all its commits had become
reachable from the base branch. `git checkout main` in that same checkout was separately blocked by
the harness's auto-mode classifier (the guardrail this instructions file already names: "never
check out `main` in the main checkout"), which is what surfaced the wrong-directory mistake before
a second one compounded it.

**Why.** Nothing in this run's own commands changed directory into the shared checkout on purpose;
the working directory the `Bash` tool started that call in was already `main`'s, left over from an
earlier command in the same session, and every prior git command up to that point had explicitly
`cd`'d into the worktree first. This one did not, because it was written as a bare follow-up to a
`gh api`/`gh pr view` sequence that does not care about `cwd`.

**Cost.** About 20 minutes: diagnosing the bad push, an `AskUserQuestion` to the navigator to choose
between a revert and a force-push (the navigator chose revert, per CLAUDE.md's stance against
force-pushing main without explicit approval), a `git worktree add --detach` against `origin/main`
to run the revert from a location the classifier does not block, one wrong `-m 1` revert attempt
that reverted the *other* side of the merge (deleting an unrelated PR's mockup file) before the
correct `-m 2` was found, and finally reconstructing this bead's branch on top of the revert because
`git rebase` treated the branch's own commits as already-upstream (they were still ancestors of the
new main tip through the reverted merge commit) and silently dropped them instead of replaying them
- caught only by diffing file counts before pushing again.

**Prevent by.** Every git command that is not the very first one in a `Bash` call must either start
with an explicit `cd` into the worktree or be preceded by a `pwd`/`git branch --show-current` check
in the same call - "the working directory persists between commands" is true within one shell
session, which spans tool calls, so a command written days into a run can silently inherit a `cd`
from three calls ago. This bead's own worktree convention (`cd
.cerebro/worktrees/<id> && git ...` as one line) should be followed for **every** git-touching `Bash`
call in *Merging* and *The review*, not only the first one after picking up the bead - the skill
already shows the pattern once and should say to repeat it, always, rather than relying on habit
partway through a long run.

**Seen before.** None found - the skill's existing worktree-discipline notes ("Check `pwd` before
any git command", "never check out `main` in the main checkout") describe exactly this failure mode
in the abstract, but no prior retrospective records it actually happening. Worth escalating to the
skill's own traps section given how close this came to landing unreviewed code on `main` silently.
