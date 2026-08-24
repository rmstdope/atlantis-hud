# ah-2ihm — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-08-24
- **PR:** #651

## The disk floor blocked the bead, and both documented reclaims were refused by the auto-mode classifier — again

**What happened.** `.claude/cerebro/scripts/disk-preflight` refused the start at 5.2 GB free against
its 8 GB floor, and named `~/.cargo/registry/src` and `~/Library/Caches/Mozilla.sccache` (786 MB
together) as the always-safe reclaims. Both `rm -rf` of those paths and
`.claude/cerebro/scripts/prune-worktrees.sh` were denied by the auto-mode classifier ("Blocked by
classifier"), so there was no reclaim I could run. I wrote `asking`, put it to the navigator, and
waited; they freed the space and the bead then ran start-to-green in about fifteen minutes. The bead
is TypeScript-only — it needed no Rust build at all.

**Why.** Established for the block, not for the classifier: the preflight advertises reclaims that
an implementer under auto mode has no permission to perform, and the three remaining large trees
(`.cerebro/worktrees/ah-lu0f.1`, `ah-v9p2`, `psylocke`) belonged to live agents and were not mine to
touch.

**Cost.** About ten minutes of navigator time, and the bead sat claimed throughout.

**Prevent by.** Either a Bash permission rule in `.claude/settings.json` allowing the two reclaim
paths `disk-preflight` itself names plus `prune-worktrees.sh`, so its advice is executable by the
agent it is printed to; or a preflight that only advertises a reclaim it has just verified it can
run. This is the navigator's call, not an implementer's.

**Seen before.** ah-y3j1 ("The disk preflight's two advertised home-directory reclaims cannot be
run"), ah-udff ("both `$HOME` reclaims were refused again, and the bead was fine anyway"), and
ah-8m0.2 / ah-1ad6.1 / ah-rsdz on the floor itself. This is at least the fifth sighting, and the
third of specifically the reclaims-are-refused shape.
