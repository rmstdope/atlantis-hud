# ah-1znc — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-08-18
- **PR:** #423

## The disk floor blocked the start of the bead, and tripped again mid-gate

**What happened.** `scripts/diskPreflight.ts` refused to let the bead start at 4.7 GB free.
`prune-worktrees.sh` reclaimed nothing — the only agent tree was Psylocke's, which it keeps by
policy. Getting over the 8 GB floor took deleting things the reclaim script does not know about:
`~/.cargo/registry/src` (2.1 GB, re-extractable from `cache` without network), the main checkout's
`target/debug` (2.0 GB), and later `~/Library/Caches/Mozilla.sccache` (2.7 GB). It then tripped a
*second* time in the middle of `pnpm run check:fast`, where it surfaces as a failing **tooling**
test — `diskPreflight.test.ts > says what it found, and succeeds while this disk has room` — which
reads like a defect in the diff rather than a full disk.

**Why.** The machine carries roughly 5 GB of build trees plus several GB of caches outside the
repository, and one smoke run plus one cargo check consumes most of the headroom the floor leaves.
`prune-worktrees.sh` only ever considers agent worktrees.

**Cost.** About 25 minutes across two stalls, plus one wasted `check:fast` run.

**Prevent by.** `prune-worktrees.sh` (or the preflight's own advice line) naming the non-worktree
reclaims that are actually safe and offline — `~/.cargo/registry/src`, `target/debug/incremental`,
`~/Library/Caches/Mozilla.sccache` — instead of pointing only at build trees it will decline to
remove. The preflight message currently sends the reader to a script that reclaims nothing.

**Seen before.** ah-9r0, ah-s0m, ah-58n.1, ah-8m0.2, ah-9lv, ah-do8.2, ah-do8.3, ah-j0e, ah-l2i.2,
ah-quw — this is at least the tenth file naming the same floor.

## The plan's dependency list was right about the vocabulary and silent about the restore

**What happened.** The plan specified the new effect as `[unitId, orderOcd, vocabulary]`, placed
immediately after the creation layout effect. With exactly that, the bead's own reported case stayed
red: after a reload the editor mounts with an **empty** document and the persisted draft is spliced
in later by the `externalRevision` effect, so the tidy ran against a blank document and never again.
The fix was to declare the effect *after* the `externalRevision` effect and key it on
`externalRevision` too.

**Why.** The plan reasoned about when the *vocabulary* arrives and not about when the *document*
does. Both are asynchronous on the path the navigator reported, and only one was in scope.

**Cost.** One smoke cycle, about 10 minutes — cheap only because the smoke test was written first
and failed loudly.

**Prevent by.** A plan that keys an effect on a late-arriving value listing every value on that
screen that arrives late, not just the one the bug named. Here `OrdersEditor.tsx` has three
asynchronous inputs — the document, the vocabulary and the setting — and the plan enumerated two.

**Seen before.** none found.
