# ah-quw — retrospective

- **Implementer:** Wolverine
- **Date:** 2026-08-17
- **PR:** #378

## The disk floor was crossed mid-bead again, and `prune-worktrees.sh` had nothing safe to reclaim

**What happened.** `pnpm exec tsx scripts/diskPreflight.ts` at the start of the run (from the main
checkout, per the skill's *Workspace* section) printed `11 GB free, above the 5 GB floor` and
green-lit the start. Twenty minutes later `pnpm run check:fast` failed in the worktree, on
`scripts/diskPreflight.test.ts > says what it found, and succeeds while this disk has room`: the
same script, run from the worktree, printed `7.8 GB free, below the 8 GB floor needed to build`.
`.claude/cerebro/scripts/prune-worktrees.sh` then reclaimed nothing — all four trees were held by
live agents or by Psylocke. The gate could not be made green on this machine, so the PR was opened
with the failure named in its body and CI (which has its own disk) was relied on as the real gate.

**Why.** Two causes, both established. First, the floor genuinely moved: the main checkout's
`diskPreflight.ts` still uses a 5 GB floor while the worktree's copy — branched from a newer
`origin/main` — uses 8 GB, so the preflight the skill tells you to run cannot answer the question the
gate will later ask. Second, free space fell ~3 GB during the run, from the fleet's shared `target/`
tree, which is exactly what ah-8m0.2, ah-9lv, ah-9r0 and ah-s0m already describe.

**Cost.** About fifteen minutes: a prune that reclaimed nothing, and a judgement call about whether
to open a PR on a red local gate.

**Prevent by.** `implement-bead`'s *Workspace* section should run the preflight **from the worktree**,
after `pnpm install`, rather than from the main checkout before it — the worktree's copy is the one
whose floor the gate enforces, and running it there would have refused the start rather than failing
an hour in. Separately, this is the fifth bead to lose time to the shared `target/` tree with no safe
reclaim available; whatever bounds that tree is a navigator decision, not an implementer one.

**Seen before.** ah-8m0.2, ah-9lv, ah-9r0, ah-s0m — all the same disk floor, none of them the
version-skew half.
