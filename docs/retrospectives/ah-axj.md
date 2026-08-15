# ah-axj — retrospective

- **Implementer:** Storm
- **Date:** 2026-08-15
- **PR:** rmstdope/cerebro#12 (fix), rmstdope/atlantis-hud#252 (submodule bump)

## A fresh implementer worktree still does not carry an initialized submodule

**What happened.** After `git worktree add -b ah-axj-bump-cerebro .claude/worktrees/ah-axj
origin/main` and `pnpm install --frozen-lockfile`, running `git -C .claude/cerebro fetch origin`
and `git -C .claude/cerebro checkout <merged-sha>` appeared to work but silently operated on the
*outer* atlantis-hud repository: `git -C .claude/cerebro remote -v` showed
`rmstdope/atlantis-hud.git`, and `checkout <cerebro-sha>` failed with `fatal: unable to read tree`
because that sha does not exist in atlantis-hud's history. `git submodule update --init --recursive`
fixed it.
**Why.** `git worktree add` does not initialize submodules, same as a plain `git clone` without
`--recurse-submodules` — the directory is not yet a git repository, so `git -C` on it walks up to
the enclosing worktree instead of erroring.
**Cost.** About 5 minutes: one failed checkout, tracing the wrong remote, then the init command.
**Prevent by.** This is the same trap `ah-4ao`'s retrospective already named, with the same fix.
It recurred because neither the `implement-bead` skill's *Workspace* section nor its cerebro-bump
increment text says to run `git submodule update --init --recursive` after `pnpm install` in a
fresh worktree — only `CLAUDE.md`'s onboarding block says it, for a fresh clone. Worth adding one
line to the skill's *Workspace* section (or wherever it describes the two-PR cerebro delivery)
naming the worktree case explicitly, since a plan (this one, and `ah-4ao`'s) can restate the
two-PR shape without knowing to restate this.
**Seen before.** ah-4ao — identical symptom, identical fix, same missing step.
