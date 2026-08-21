# ah-qled.4 — retrospective

- **Implementer:** Wolverine
- **Date:** 2026-08-21
- **PR:** rmstdope/cerebro#75

## `touch` in a cerebro test fixture followed the consumer's symlinks into the real checkout

**What happened.** A cerebro test fixture builds a throwaway consumer whose `.claude/cerebro/scripts/*`
are **symlinks into the real cerebro checkout**, and those symlinks are tracked, so every `git worktree
add` in the fixture checks them out again. Aging a fixture tree with
`find "$tree" -exec touch -t <stamp> {} +` therefore followed each one and stamped the *real*
repository's script files, while leaving the fixture's own symlinks at their checkout time. The tree
under test stayed warm, `merged_check none` correctly declined to reclaim it, and the failure read
exactly like the feature being broken.

**Why.** Established. `touch` follows symlinks unless given `-h`. `find -exec touch` in a directory
containing tracked symlinks-to-elsewhere is the specific shape; nothing in the existing fixtures had
it, because `tests/prune-worktrees.sh` only ever aged a `target/` directory it had created itself,
which contains no symlinks.

**Cost.** About fifteen minutes and one wrong hypothesis (that `project-conf` was not resolving the
key), plus a set of real-repository files given 2026-01 mtimes for a few seconds.

**Prevent by.** `implement-bead`'s *Traps this repository has already paid for* should carry: **in a
cerebro test fixture, age files with `touch -h`.** The consumer layout these fixtures build is
symlinks into the real checkout by construction, so any fixture that ages a *worktree* rather than a
directory it created itself will hit this. The symptom to recognise is a fixture assertion failing
because the tree under test is warmer than it was stamped to be.

**Seen before.** None found — no retrospective mentions `touch -h` or symlink-following.

## Backticks in a `git commit -m` message were evaluated by the shell and a word vanished

**What happened.** A commit message written inline as
`git commit -m "The multi-directory \`pass\` was vacuous …"` came out as *"The multi-directory  was
vacuous"*. The shell ran the backticked word as a command; `pass` is not one, so it printed
`command not found: pass` and substituted the empty string. The commit and the push both succeeded,
so nothing failed loudly — only the message was silently the wrong text. It was noticed only because
the stray `command not found` line appeared beside two unrelated `gh` outputs.

**Why.** Established. Backticks are command substitution inside double quotes, and the escaping
needed to survive both this harness's quoting and the shell's is not what it looks like.

**Cost.** Small — one `--amend` and a force-push. What makes it worth recording is that it fails
*silently into the permanent record*: a squash-merged commit message is what a future reader has.

**Prevent by.** CLAUDE.md's *GitHub CLI* section already says **never use backticks in the text with
`gh`**. The same rule holds for `git commit -m`, and neither that section nor `implement-bead` says
so — the warning currently reads as being about `gh` specifically. Widen it to: **write any commit
message or PR body containing backticks with a heredoc (`-F -`), never with `-m`.** That is what the
amend used, and it worked first time.

**Seen before.** None found — no retrospective mentions backticks.
