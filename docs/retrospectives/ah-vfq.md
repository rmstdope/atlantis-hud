# ah-vfq — retrospective

- **Implementer:** Wolverine
- **Date:** 2026-08-17
- **PR:** #391

## `shortcuts.spec.ts:239` "right-click centres the view on a hex" failed in CI again, on a diff that touches no map code

**What happened.** `smoke (desktop-shell, 1, 2)` failed on the same centring assertion
(`expect.poll(() => mapTransform(page)).toBe(centred)` at `tests/smoke/shortcuts.spec.ts:290`, with
`:272`'s `not.toBe(before)` failing on the retry) on a PR whose diff is the orders-completion
boundary — the core lexer, two bindings and three CodeMirror completion sources. Nothing in it can
move the map. `pnpm run test:smoke -- shortcuts.spec.ts` locally: 16 passed, 25s, first attempt. One
`gh run rerun --failed` was green. It then failed a **second** time on this same PR, on the same
shard, after the branch was caught up to main — green again on the next re-run, with two of the two
allowed re-runs spent on it.
**Why.** Not established, same as the first sighting. The assertion compares a rendered SVG
transform to two decimal places after a poll, which a not-yet-settled layout on a slow runner would
fail exactly this way.
**Cost.** Two re-runs, about fifteen minutes of CI wall-clock, plus the local reproduction — the
whole of this bead's re-run budget, spent on a test the bead does not touch.
**Prevent by.** This is the second and third sighting in two days, on two different shards (`web, 1, 2` then
`desktop-shell, 1, 2`) and on two unrelated diffs, which is what ah-do8.3 asked for before acting.
The assertions at `tests/smoke/shortcuts.spec.ts:272` and `:290` want a tolerance on the transform
rather than exact string equality; that is a change to a test outside any planned bead, so it is the
navigator's to make.
**Seen before.** ah-do8.3 — same spec, same assertions, same "unrelated diff, green on re-run".

## The disk preflight failed the gate again, and this time the fix was in my own worktree

**What happened.** `pnpm exec tsx scripts/diskPreflight.ts` passed at 8.8 GB when the bead started
and `scripts/diskPreflight.test.ts` failed at the gate at 6.8 GB against its 8 GB floor — again the
one red test in an otherwise green `check:fast`. `prune-worktrees.sh` had nothing safe to reclaim.
**Why.** Four agent build trees, 9 GB between them. My own worktree's `target/` was 2.6 GB of that.
**Cost.** A few minutes, and one extra pass over the gate.
**Prevent by.** Nothing new for the navigator; recorded for the count and for one detail the earlier
files do not have: once `cargo fmt --check` and `cargo clippy` have run, the Rust half of the gate is
done, and `cargo clean` in one's own worktree (3.4 GB here, 6.8 → 9.4 GB free) makes the disk test
pass without touching another agent's tree. That is the safe order when the preflight fails at the
gate rather than at claim time.
**Seen before.** ah-do8.3, ah-8m0.2, ah-9r0, ah-9lv, ah-do8.2, ah-l2i.1, ah-quw, ah-s0m.
