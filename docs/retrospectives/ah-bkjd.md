# ah-bkjd — retrospective

- **Implementer:** Wolverine
- **Date:** 2026-08-22
- **PR:** #555

## "the faction view uses the window before it scrolls" has now failed locally in four beads and passed in CI in all four

**What happened.** Both full local smoke runs reported
`workspace.spec.ts › the faction view uses the window before it scrolls` failing on `web` and
`desktop-shell` (`toBeInViewport`, viewport ratio 0). The spec contains no `getByRole` call at all,
so it could not have been touched by this bead. I established that by `git stash`ing the whole diff
and running the single spec against unmodified `origin/main`, where it failed identically. CI on the
same commit was green on all four smoke shards.

**Why.** Not established here either. The assertion depends on the last attitude row fitting inside
a 720px-tall window, so it is sensitive to whatever makes this machine's rendered rows taller than
the runner's — but nobody has proved that, across four attempts.

**Cost.** About four minutes this run: one stash-and-run to prove it was not mine, and the judgement
call about whether to enter the merge with a red local suite. Small on its own; the point is the
fourth.

**Prevent by.** Not by another implementer re-deriving it. Either quarantine it with
`test.skip(({ browserName }) => ...)` or a tolerance that is not the literal viewport height, or
name it in `.claude/cerebro-traps.md` as known-red locally and green in CI — a project traps file is
exactly where a fact like this belongs, and this repository has none. That is a change outside a
planned bead, so it is the navigator's; this file is the fourth data point for it.

**Seen before.** `ah-9ess.md`, `ah-2a96.md`, `ah-o2li.md` — all three name this same spec, and
`ah-2a96` names it among a set that made "run the smoke suite green" unusable as an acceptance test.

## Proving the ratchet bites, by reverting one line, cost the run's uncommitted work

**What happened.** The plan's validation asks that reverting `exact: true` on one selector fails the
new assertion. I did that with `sed`, confirmed the failure, and undid it with
`git checkout tests/smoke/workspace.spec.ts` — which restored the file to HEAD and silently discarded
all 52 of that file's uncommitted tightenings along with the one-line experiment.

**Why.** `git checkout -- <path>` takes no account of what in the file was deliberate. The experiment
and the work lived in the same file, and nothing distinguished them.

**Cost.** Small — the edits were script-generated, so re-running it took two minutes — but only
because they happened to be reproducible. The same mistake on hand-written work is unbounded.

**Prevent by.** Commit before running a deliberately-destructive validation, then undo the experiment
with the inverse edit or `git stash`. A validation step that asks you to break something on purpose
is the moment to have a commit to fall back to, and `implement-bead`'s *Validation* guidance does not
say so.

**Seen before.** None found.
