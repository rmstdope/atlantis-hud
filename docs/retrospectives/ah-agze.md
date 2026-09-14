# ah-agze — retrospective

- **Implementer:** Rogue
- **Date:** 2026-09-14
- **PR:** #1254

## main's Rust test build did not compile after two PRs merged cleanly one after the other

**What happened.** The first `cargo test -p atlantis-hud-core` in a fresh worktree off `4dbe9cf8`
failed with `E0061: this function takes 6 arguments but 5 arguments were supplied` at
`crates/core/src/orders/effects.rs:4071`, in no file this bead touched. a5b8bdb6 (#1249, ah-xmqo)
had added an `ordered` parameter to `effects::settle`; 4dbe9cf8 (#1250, ah-z9g8), merged next,
added the test `a_decided_row_answers_the_gate_itself` calling it with the old five arguments.
Each PR was green against its own base; main's CI run for 4dbe9cf8 concluded `failure`. The
one-line repair rides in this PR, announced under its Deviations.

**Why.** Established: a semantic conflict git merges without a marker. `main` has no branch
protection (`gh api .../branches/main/protection` answers 404), so a `BEHIND` PR is merged without
being re-tested against the head it lands on — the risk `implement-bead`'s *Merging* names as
knowingly taken.

**Cost.** About ten minutes to diagnose and repair, plus a review finding and a reply about an
out-of-scope edit. Every other implementer branching off main in the meantime hits the same
compile error in its first test run.

**Prevent by.** Either a post-merge alarm — something that notices main's CI concluding `failure`
and tells the fleet (Cerebro's sweep could read `gh run list --branch main`) — or `strict`
required checks on `main`, which the *Merging* section already honours when set. The navigator's
choice; recorded here because it has now happened twice.

**Seen before.** ah-1wcw.6 — main red after ah-1wcw.1 merged, unnoticed until the next bead's CI.
