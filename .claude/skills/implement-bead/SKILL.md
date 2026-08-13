---
name: implement-bead
description: The implementation role — take the next planned bead, build it under TDD, get it reviewed and merged, and loop. Use when running an implementation session in atlantis-hud.
---

# Implementing a planned bead

You take beads somebody else planned, build exactly what the plan says, and see them onto main. Then
you take the next one. Several of you may run at once.

Read `beads-workflow` for the label lifecycle and CLAUDE.md's Four Eye Principle for the review
rules; this is the role on top of them.

## Standing approval, and where it comes from

The `test-driven-development` skill stops at every phase for the navigator, and says a merge is
never covered by a blanket approval. This role is the documented exception, and the authority is
**CLAUDE.md's Four Eye Principle**, which the navigator wrote for exactly this: for a planned bead,
the Copilot reviewer is the second pair of eyes, and an implementation session merges on the
conditions stated there. Where the two disagree, CLAUDE.md governs this repository.

So: RED → GREEN → REFACTOR → COMMIT without stopping, announcing each transition, and still stopping
on a genuine design question — see *When the plan is wrong*. Everything outside a planned bead
follows the TDD skill's gates as written.

## Picking up

```bash
bd dolt pull
bd ready --label planned --exclude-label human --exclude-type epic --claim --json
bd dolt push                               # so other machines see the claim
```

`human` is work already waiting on the navigator; `epic` is a split parent, which has children
rather than a plan. Claiming either means refusing it a minute later.

`bd heartbeat <id>` at every phase gate and before anything long — a full gate run, a CI watch. The
lease is short, about five minutes, and a cycle is an hour; the exact TTL is bd's and not
configurable here, so heartbeat on every boundary rather than on a timer.

Nothing planned means the planner has not got there yet. Look again every few minutes, saying so
once rather than every time. After **half a dozen empty checks**, say that the queue is dry and stop
— an idle session that looks busy is worse than one that has plainly finished, and the navigator can
start you again in a second.

**Read the plan with `bd show <id> --json`.** The pretty renderer mangles it.

**Refuse a plan missing a mandatory section** — context, files and reuse, increments with their
tests, test plan, user-facing decisions, out of scope, validation, traps:

```bash
bd update <id> --remove-label planned --add-label human --append-notes "<the section that is missing>"
bd unclaim <id>
bd dolt push
```

All three, and this is the **hand-back block** referred to throughout. `bd update` sets no status, so
without `bd unclaim` the bead stays `in_progress` under you after you have moved on — invisible to
`bd ready` and stranded until its lease expires. Without the push, no other machine learns it was
released. If a worktree exists by then, remove it too (see *Finishing*).

## Workspace

Check there is room before starting — a build that runs out of disk fails inside the linker with a
message that reads like a code fault:

```bash
pnpm exec tsx scripts/diskPreflight.ts    # prints what it found; non-zero means do not start
```

Never check out `main` — another agent usually holds it:

```bash
git -C <repo> fetch origin main
git -C <repo> worktree add -b <id>-short-description <repo>/.claude/worktrees/<id> origin/main
cd <repo>/.claude/worktrees/<id> && pnpm install --frozen-lockfile
```

The install is not optional: a fresh worktree has no `node_modules`, so the first `pnpm run lint`
fails for a reason that has nothing to do with the bead.

Worktrees must stay under `.claude/worktrees/`. `bd` and cargo both find their configuration by
walking up, so a worktree outside the repository silently gets its own empty bead database and its
own multi-gigabyte build directory.

**Check `pwd` before any git command.** A shell keeps its directory between commands, so one `cd`
into another agent's worktree to look at something leaves every later command there — and a
`git checkout -b` then moves that agent off its own branch.

Give the session its own ports so two agents never test each other's bundle. Blocks are ten apart and
4173 is the default, so **pick one nobody is using and check before claiming it**:

```bash
lsof -i :4183 -i :4184 -i :4185     # silence means the block is free; try 4193, 4203, ... otherwise
export SMOKE_PORT_BASE=4183
export CI=1                          # so a dying server from your own last run is never reused
```

There is no registry, so the check is the whole mechanism. The configs pass `--strictPort`, so a
collision fails loudly rather than serving you somebody else's bundle — but it does stall both runs.

## Building

Follow the plan's increments in order, each opening with its named failing test. Run **`pnpm check`**
before the PR rather than assembling the steps yourself: it orders them cheap-to-dear and, crucially,
puts `build:web` between `test:smoke` and `test:pwa`, which is the difference between a passing PWA
run and twenty minutes spent "fixing" a service worker that was never broken.

The browser suites inside it take a **machine-wide lock**, so with a peer running its own gate yours
waits — quietly, and possibly for minutes. That is the lock working, not a hang. Do not go looking
for something to kill.

`test:native` is **not** in `pnpm check` and needs a Linux runner, so its first CI failure is
something to diagnose rather than something you could have caught locally.

## When the plan is wrong

A detail the plan missed is yours to decide — do it, and record the deviation in the PR body.

Anything touching **approach, scope, or what the user sees** goes back, by the same hand-back block as a missing section, worktree included. You were given a plan precisely so those decisions were made elsewhere; making
them here is the failure mode this split exists to prevent.

## The review

**You cannot request the review, so do not try.** It is requested automatically when the PR opens and
re-reviews itself after a push. Both plausible commands fail and one fails quietly:
`gh pr edit <n> --add-reviewer Copilot` errors, and `POST /pulls/<n>/requested_reviewers` answers 200
while changing nothing.

Wait for a review whose commit matches your head:

```bash
gh api repos/<owner>/<repo>/pulls/<n>/reviews \
  --jq '[.[] | select(.user.login | startswith("copilot")) | .commit_id] | last'
```

Every review seen on this repository has been `COMMENTED`, never `APPROVED`, so do not wait for an
approval.

**Every comment gets a change or a posted reply saying why not**, and the thread resolved:

```bash
# read them
gh api repos/<owner>/<repo>/pulls/<n>/comments --jq '.[] | "\(.id)|\(.path):\(.line)|\(.body)"'
# reply
gh api repos/<owner>/<repo>/pulls/<n>/comments/<comment-id>/replies -f body='...'
# resolve — gh has no built-in for this, so it is the GraphQL mutation
gh api graphql -f query='{repository(owner:"<owner>",name:"<repo>"){pullRequest(number:<n>)
  {reviewThreads(first:20){nodes{id isResolved}}}}}' \
  --jq '.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved==false) | .id'
gh api graphql -f query='mutation{resolveReviewThread(input:{threadId:"<id>"}){thread{isResolved}}}'
```

Take the comments seriously. On this repository they have caught a lock that could be stolen a
millisecond after being taken, a refusal message that rounded itself into a contradiction, and a
release step that could strand a version bump — but they also raise things that are wrong or do not
apply. Judge each one; a reasoned reply is a complete answer.

A rebase that only replays your commits does not need a fresh review; a push that changes code does.

**No review within about twenty minutes**: leave the PR open, escalate the bead (the hand-back block above, worktree included), say so plainly, and take the next bead. Some PRs never get one. Merging anyway is not the
answer, and neither is waiting forever.

## Red CI

Three fix attempts. Diagnose, fix, push — and read the failure before believing it: a wall of
identical connection errors is infrastructure, not a defect.

A suspected flake gets the job re-run instead, capped at two re-runs, and only after you have
reproduced it locally once. Without that cap, "it was a flake" is an unbounded loop that ends with a
genuinely broken timing test merged.

On exhaustion, leave the PR open, escalate, move on.

## Merging

Expect `BEHIND` on most merges: with several agents, a PR that sat through one review round has
usually been overtaken. **Rebase, re-run the local gate, and wait for CI again.** It costs a full
cycle each time and that is the accepted price — a green gate on a stale tree is evidence about a
tree that will never exist, and two agents changing the same function compatibly is exactly what
this catches.

```bash
gh pr merge <n> --squash --delete-branch
```

**Never `--auto`.** On this repository the ruleset requires checks but no review, so auto-merge fires
on green checks alone: it does not wait for the reviewer and it races any fix you push afterwards.
PR #142 merged that way four minutes before its review arrived, and the fixes that review prompted
had to ship as a second PR.

`--delete-branch` often aborts with `'main' is already used by worktree` — the merge has already
happened by then. Check `git ls-remote --heads origin <branch>` and delete it explicitly if it
survived.

## Finishing, then going again

```bash
bd close <id> --reason "Delivered in PR #NN"
git -C <repo> worktree remove --force .claude/worktrees/<id>
git -C <repo> worktree prune
bd dolt push
```

`--force`, because `worktree remove` refuses a tree holding untracked files and would otherwise abort
at the very end of a session — leaving the worktree, its branch and its build artifacts behind. The
two commands are separate rather than chained for the same reason: a failure in the first should not
skip the second.

**Do this on every exit, not only this one.** A bead handed back, a review that never came, a CI
budget spent — each of those leaves a worktree too, and nothing else cleans them up.

Then pick up the next planned bead. Say what you merged and anything the navigator should know —
a deviation, a trap the plan missed, a bead you handed back.

## Traps this repository has already paid for

- **The PWA suite after the smoke suite.** Smoke rebuilds `apps/web/dist` with the service worker
  disabled, so `test:pwa` straight afterwards fails with page timeouts and no worker. `pnpm check`
  orders `build:web` before `test:pwa` for exactly this reason. Rebuild; do not "fix" the worker.
- **A leftover preview server.** Without `CI=1`, Playwright reuses an existing server — including
  your own dying one from the previous run — and tests the bundle it is serving. That produced a
  "65 passed" and a "40 passed" run of a 138-test suite before anyone noticed.
- **`pnpm run test:smoke -- --project=web`** forwards the `--`, which Playwright reads as a
  positional filter: it matches no spec after building and serving, and looks exactly like a hang.
- **WebKit's driver** answers `""` for text it considers clipped, so a Chromium assertion can pass
  while the native shell shows nothing. `native` is the job that tells you.
- **A stale lease is not an abandoned agent** unless it is genuinely stale — see `beads-workflow`
  before reclaiming anything.
