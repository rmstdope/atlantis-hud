---
name: beads-workflow
description: How planned work is tracked in this repository with beads (bd) — picking up work, writing a good bead, modelling dependencies, branch/commit conventions, and the GitHub bug-report bridge. Use whenever work is selected, created, updated, or closed in atlantis-hud.
---

# Beads workflow (atlantis-hud)

Planned work lives in **beads** (`bd`), not in GitHub issues. GitHub issues are the inbox for
external requests and bug reports only.

Bead IDs look like `ah-t65`. Partial IDs work: `bd show t65` finds `ah-t65`.

## Daily loop

```bash
bd dolt pull                   # other machines' claims arrive only here
bd ready                       # what can be worked on now (no open blockers)
bd show <id>                   # scope, acceptance criteria, validation, dependencies
bd update <id> --claim         # FIRST action after choosing — see "Claiming" below
bd dolt push                   # publish the claim now, not at session end
git checkout main && git pull origin main
git checkout -b <id>-short-description
# ... test-driven-development skill: RED → GREEN → REFACTOR → COMMIT ...
# ... bd heartbeat <id> at every phase gate, and before any long wait ...
bd close <id> --reason "Delivered in PR #NN"
bd dolt push                   # back the bead database up to the remote
```

`bd blocked` shows what is waiting and on what. `bd list` shows everything.

## Claiming, and not colliding

Several agents work this backlog at once, so a claim is the only thing keeping two of them off the
same bead. Five rules, and the second is the one that is easy to forget and expensive to skip.

**Claim before you explore, not before you branch.** `bd update <id> --claim` is the first thing you
do after choosing a bead — ahead of reading code, planning, or asking the navigator anything.
Planning a bead takes ten minutes or more, and until the claim lands the bead is still on every
other agent's `bd ready`. The claim is atomic, so a failure means somebody else won the race: pick
another bead rather than retrying.

**Heartbeat while you work.** A claim carries a lease of about five minutes, and only
`bd heartbeat <id>` pushes it forward. A cycle here — RED, GREEN, REFACTOR, the local gate, CI —
runs an hour or more, so a claim that is never heartbeated is stale for almost all of the work it
covers. Send one at every phase gate and before anything long (a full smoke run, a CI watch).
Heartbeats write no Dolt commit and no history, so the cadence costs nothing.

**Never take a bead off another agent by yourself.** `in_progress` with an assignee is authoritative
whatever the lease says. `bd reclaim`, `bd update --force` and reassigning over a live claim all
need the navigator's approval first — here an expired lease means "nobody heartbeated", which is the
normal state of live work, not "the worker died". See the Traps section.

**Push the claim immediately.** Leases never leave the machine that granted them; only status and
assignee commit, and they travel only on `bd dolt push`/`bd dolt pull`. A claim that is not pushed is
invisible to an agent on another machine for as long as you hold it.

**Check your working directory before any `git` command.** The other agents are in
`.claude/worktrees/*`, and a shell's directory persists between commands — one `cd` into a worktree
to check something leaves every later command there. Branching from that shell checks a branch out
inside somebody else's live worktree, which is a collision the bead graph cannot prevent. This has
happened: a `cd .claude/worktrees/task` to see whether worktrees share the database was followed,
several commands later, by a `git checkout -b` that moved that agent off its own branch. Run
`pwd && git branch --show-current` before branching, or give `git -C /path/to/repo` the path
outright.

If `main` is checked out in another git worktree, `git checkout main` fails; use
`git checkout -b <branch> origin/main` instead.

## Branch, commit and PR conventions

- Branch: `<bead-id>-short-description`, e.g. `ah-t65-load-multiple-reports`
- Commit subject: `feat(ah-t65): load multiple reports` (`fix(...)`, `docs(...)`, `chore(...)`)
- PR title: the same subject. PR body names the bead, and the originating GitHub issue if one exists.
- One bead per branch. Merge it before starting the next bead.

## Writing a good bead

A bead is executable when someone else could pick it up cold. Carry the same five things the
implementation plan asks of every work package:

| What | Where it goes |
|---|---|
| Summary and problem | `--description` (markdown; use `--body-file` for anything long) |
| Scope and out of scope | `--description` |
| Acceptance criteria | `--acceptance` |
| Validation (commands, manual checks) | `--description` |
| Inputs it depends on | dependency edges, not prose — see below |

```bash
bd create "Load multiple reports" --type feature -p 2 --body-file scope.md \
  --acceptance "Selecting several .rep files imports them in header order"
```

Types used here: `feature`, `bug`, `task`, `epic`. Priorities `P0`–`P4`, default `P2`.

Do not restate a dependency in the description — model it, so `bd ready` stays truthful.

## Dependencies and breakdown

```bash
bd dep add <blocked-bead> <blocker-bead>            # blocked-bead is blocked by blocker-bead
bd dep add <a> <b> --type relates-to                # related, but not blocking
bd create "Sub-task title" --parent <bead-id>       # hierarchical child
```

Beads has real parent links and dependency edges, so the old `Sub-issue (NN):` title prefix is gone.
When a bead turns out to be larger than one increment, split it into children and wire the order with
`bd dep add`; do not grow the parent.

## GitHub bug-report bridge

```bash
GITHUB_TOKEN=$(gh auth token) bd github pull <issue-number>   # import as a bead, keeps gh-<n> ref
GITHUB_TOKEN=$(gh auth token) bd github status                # verify configuration
```

`bd github pull` generates a long legacy-style ID. When the bead is going to be worked on rather than
just recorded, prefer creating it with a rewritten scope and a back-reference:

```bash
bd create "Title" --type bug --external-ref gh-<n> --body-file body.md
```

Then comment on the GitHub issue naming the bead and close it. Nothing is pushed from beads to
GitHub automatically; the sync is pull-only and manual.

## Storage, and what is committed

- `.beads/embeddeddolt/` — the Dolt database. Local, git-ignored, the source of truth.
- `.beads/issues.jsonl` — a readable export, **committed**, so the backlog is browsable in the repo.
  It is a snapshot taken when somebody happens to push main, not a mirror, and it lags — often by
  several beads. That is deliberate: see the export gate below for why no branch may carry it, and
  `bd dolt push` for where bead state actually travels. Refresh it by hand from main
  (`bd export -o .beads/issues.jsonl`) when a readable diff is wanted; never read it as truth.
- `.beads/config.yaml`, `.beads/hooks/` — committed configuration and the git hook shims
  (`core.hooksPath` points at them).
- The Dolt remote is the repo's own GitHub origin, under `refs/dolt/data`. `bd dolt push` backs it
  up; `bd dolt pull` retrieves it on another machine.

Never commit a GitHub token to `.beads/config.yaml` — pass it as `GITHUB_TOKEN` per command.

## The export gate

`scripts/beadsExportGate.ts` runs from `.beads/hooks/pre-push`, below the `BEADS INTEGRATION`
markers where `bd hooks install` leaves it alone. **On main only**: it exports the database and
compares the result with the committed `.beads/issues.jsonl`. Equal, and the push goes through
silently. Different, and it commits the fresh export alone as
`chore(beads): refresh the issues export` and stops the push:

```
beads: .beads/issues.jsonl was out of date and has been committed as "chore(beads): refresh the issues export".
beads: nothing was pushed - run the push again to send it along.
```

Push again and it goes. A pre-push hook cannot amend the commits being pushed, so the refresh is a
commit of its own — nothing is rewritten and `--force` is never needed. Expect this on main, once,
after beads changed.

**A feature branch never carries the export**, and this is the point rather than an optimisation.
The file is a snapshot of the whole database — which every agent on this machine shares — not of the
branch holding it. Two branches pushed minutes apart each carried a complete backlog from a
different instant, so whichever merged last reverted every close, claim, label and plan recorded in
between; because each side had rewritten a different subset of the one-line-per-bead file, git
usually did not even call it a conflict. Bead state travels by `bd dolt push`, not by the export.

The gate stands aside rather than blocking a push when it cannot do its job: no `bd` on `PATH`, no
`.beads` directory, no installed `node_modules`, a detached HEAD, or a `bd export` that fails.

## Traps

**The auto-export was stale, which is why it is off.** Auto-export is throttled to once a minute,
and the pre-commit hook was seen writing a snapshot that still held a bead deleted minutes earlier.
`export.auto` is `false` here and the refresh happens at push time instead — see the export gate
above. If you ever export by hand, check what actually landed rather than trusting the
acknowledgement:

```bash
git show HEAD:.beads/issues.jsonl | wc -l      # against `bd list` — the counts must agree
```

**`bd config set` accepts unknown keys silently.** A mistyped or invented key prints
`Set <key> = <value>` and does nothing, so config probing reads as success while changing nothing.
Confirm the effect, not the acknowledgement. Writing config also rewrites `.beads/config.yaml` — it
has rewritten a commented-out default and dropped the file's trailing newline — so read the diff
before committing it.

**A stale lease here does not mean an abandoned worker.** `bd update --force` describes itself as
being for "abandoned claims — crashed agent, expired lease", and `bd reclaim` is built to clear the
assignee of any in_progress bead whose lease expired and set it back to open. Both are written for a
deployment where workers heartbeat; nothing in this repository did until recently, so every live
claim matched the description of a dead one. This is what had agents starting on each other's work.
Read a stale lease as "nobody heartbeated", check with the navigator, and heartbeat your own claims
so nobody has to guess about them.

```
◐ ah-xde · Remove the Classic map theme   [P2 · IN_PROGRESS]
Lease: expires in 1 min (heartbeat 3 mins ago)      # an agent actively working, ten minutes in
```

`claim.ttl` is not part of the documented config surface — `bd config get claim.ttl` answers "not
set", and per the trap below that is also what an invented key answers — so lengthening the TTL is
not a lever. Heartbeat instead.

**`owner` comes from `git config user.email`** at creation time and has no override.  `--actor`
sets `created_by` only, `--assignee` is a separate field, and no config key changes it. The
committed export therefore carries the repo's committer address; that is the same identity every
commit already carries here, so it is expected rather than a leak.

## Checklist before ending a session

- [ ] Bead claimed or closed to match reality
- [ ] Nothing left `in_progress` that you are not actually working on — `bd unclaim <id>` releases it
- [ ] `bd dolt push`

The JSONL export is not on this list on purpose — the export gate takes it at push time.
