# ah-2n3.1 — retrospective

- **Implementer:** Wolverine
- **Date:** 2026-08-15
- **PR:** rmstdope/cerebro#20, atlantis-hud (this PR, bump)

## `pnpm run check`'s tooling suite failed again on a live sibling worktree outside `.claude/worktrees/`

**What happened.** `pnpm check` in the bump-PR worktree aborted at the tooling suite
(`scripts/cargoTargetDir.test.ts`, "keeps the worktrees inside the repository") with a live
`/private/tmp/.../scratchpad/pr-epic` worktree flagged as a stray. `git worktree list` on the shared
repository confirmed it belongs to another concurrent session, not this bead. I ran the remaining
gate steps by hand (`test:smoke`, `build:web`, `test:pwa`, `cargo fmt --check`, `cargo clippy`) to
confirm the branch was otherwise green, per the same workaround `ah-sup` already recorded.
**Why.** Unchanged from `ah-sup`: the test enumerates every worktree the machine's git knows about,
not just this session's own, so any concurrent implementer/planner/navigator worktree living outside
`.claude/worktrees/` fails it for whoever's branch happens to be under test at that moment.
**Cost.** About five minutes: one full `pnpm check` run to hit the abort, then the five remaining
steps run manually.
**Prevent by.** Nothing to change in this bead's own work, same as `ah-sup`'s finding. The
project-level fix (scope the check to worktrees this session created, or document the
`git worktree list` sanity check in `implement-bead`) is still outstanding — this is the second time
it has cost an implementer real minutes, which is stronger evidence it is worth doing than the first
occurrence alone was.
**Seen before.** `ah-sup` — identical symptom (a concurrent session's worktree outside
`.claude/worktrees/` failing the tooling suite's stray-worktree check), same workaround.

## Writing a state file from inside the bead worktree silently lands it in the wrong place

**What happened.** After merging PR 1 and `cd`ing into `.claude/worktrees/ah-2n3.1` to update the
submodule pointer for PR 2, I ran `.claude/cerebro/scripts/implementer-state Wolverine working
--bead ah-2n3.1 --phase gate --pid $PPID` from inside that worktree (cwd was the worktree root, not
the shared atlantis-hud checkout). It exited 0 and printed only the expected shim deprecation line —
but the fleet-visible file at `<repo>/.claude/agents-state/Wolverine.state.json` (still
`.claude/implementers/` in the shared checkout at that point - this PR had not yet merged) was
untouched; the write instead landed at
`.claude/worktrees/ah-2n3.1/.claude/agents-state/Wolverine.state.json`, inside the worktree itself,
invisible to the real fleet view and gitignored there too. I only caught it by `cat`-ing the real
file afterwards and noticing the phase hadn't advanced.
**Why.** `agent-state`/`implementer-state` derive the consumer root as `$script_dir/../../..` from
its own location. Called via `.claude/cerebro/scripts/...` (a path relative to cwd), that resolves
inside *whatever* `.claude/cerebro` the shell's cwd happens to be under — the shared checkout when
cwd is the atlantis-hud root, but the worktree's own submodule copy when cwd has been `cd`'d into a
bead worktree, since a fresh worktree gets its own initialized copy of the submodule (see `ah-4ao`
and friends on that copy existing at all). Nothing about the command or its output distinguishes the
two; both succeed silently.
**Cost.** About 2 minutes: noticing the phase hadn't changed, tracing it to cwd, and re-running the
same command from the atlantis-hud root, which fixed it immediately.
**Prevent by.** `implement-bead`'s state-file table already shows several transitions as `cd
/Users/henrikku/repos/atlantis-hud` immediately before the write, but not all of them, and does not
say why the `cd` matters. Worth a one-line note next to the state-file table: always run
`.claude/cerebro/scripts/agent-state` (or its shim) from the shared checkout root, never from inside
a bead worktree, because the same relative path resolves to a different, invisible file when cwd is
the worktree.
**Seen before.** None found (`grep -rl "repo_root\|wrong location" docs/retrospectives/` turned up
only `ah-3bl`, which is the unrelated `git -C` path-resolution trap in cerebro-repo worktree setup).
