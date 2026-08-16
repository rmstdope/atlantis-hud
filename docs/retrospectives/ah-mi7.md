# ah-mi7 — retrospective

- **Implementer:** Storm
- **Date:** 2026-08-16
- **PR:** rmstdope/cerebro#34, atlantis-hud#302

## The session's own instructions were already stale: the shared checkout's `main` was five commits behind, mid-`.cerebro/` migration

**What happened.** I claimed ah-mi7 and worked from the guidance baked into my launch context — the
`CLAUDE.md` snapshot and the `implement-bead` skill text, both saying worktrees live under
`.claude/worktrees/` and state files under `.claude/agents-state/`. I built the cerebro-repo PR
(#34) correctly under that, but when I created the atlantis-hud bump-PR worktree at
`.claude/worktrees/ah-mi7` and ran `pnpm run check:fast`, `scripts/cargoTargetDir.test.ts` failed:
`strayWorktrees` flagged my own worktree as being outside the repository, because `AGENT_WORKSPACES`
in that script had already been changed to `.cerebro` by a very recent commit
(`4c718d8`, bead `ah-v82`, merged onto `origin/main` before I ever branched). The shared checkout at
`/Users/henrikku/repos/atlantis-hud` was five commits behind `origin/main` and its own `CLAUDE.md`
on disk still said `.claude/worktrees/` too — but that was because nobody had pulled it since the
migration landed, not because the migration hadn't happened. I had to `git pull --ff-only` the
shared checkout, `git submodule update`, remove and recreate my worktree under
`.cerebro/worktrees/ah-mi7`, and reinstall dependencies there before the gate would pass.

**Why.** Two things compounded: (1) `implement-bead`'s *Picking up* section never pulls the shared
checkout's own `main` branch before branching from `origin/main` — it fetches and branches
`origin/main` directly into the worktree, which is correct for the *branch*, but the shared
checkout's own working copy of `CLAUDE.md`, the skills, and `.claude/cerebro` itself are read from
whatever `main` happens to be checked out to locally, and nothing keeps that current. (2) My own
system-prompt snapshot of `CLAUDE.md` is fixed at session start and cannot self-update mid-session,
so once a path convention changes on `origin/main` while I am mid-bead, I have no signal that my own
instructions are describing a repository that no longer exists — I only found out because a test
failed for a reason that looked unrelated to my diff.

**Cost.** About 20 minutes: one full `pnpm run check:fast` run to hit the failure, tracing it to
`AGENT_WORKSPACES`, discovering the shared checkout was behind, fast-forwarding it, and relocating
the worktree.

**Prevent by.** `implement-bead`'s *Picking up* section should `git pull --ff-only` (or at least
`git fetch` and compare) the shared checkout's own `main` before doing anything else — not just
`origin/main` for the branch point — so a mid-flight convention change (a path, a script, a
skill) is picked up before it silently invalidates the instructions a session was launched with.
This is a structural gap in the shared-checkout bookkeeping, not a fix I should make myself from
inside a planned bead.

**Seen before.** `ah-2n3.1` — same test (`cargoTargetDir.test.ts`'s stray-worktree check), a
different cause (a concurrent session's worktree outside the agreed location, not a stale local
`main`). `ah-v82` is the migration itself; this is the first report of a session finding out about
it the hard way, from a checkout that hadn't pulled.
