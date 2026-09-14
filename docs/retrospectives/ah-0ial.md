# ah-0ial — retrospective

- **Implementer:** Wolverine
- **Date:** 2026-09-14
- **PR:** #1255

## The PR's clippy went red because main itself was broken by two compatible-looking merges

**What happened.** CI's `rust` job failed at `cargo clippy --workspace --all-targets -- -D warnings`
in 43s, while the same command was clean locally. The failure was not in this diff: CI builds the
`pull_request` merge commit, and main at `4dbe9cf8` (ah-z9g8, #1250) did not compile —
`error[E0061]: this function takes 6 arguments but 5 arguments were supplied` at
`crates/core/src/orders/effects.rs:4071`, a new test calling `settle` after a concurrent merge
had widened it. `gh run list --branch main --workflow ci.yml` showed main's own run red at the same
step; `4d2ff30c` (ah-agze, #1254) fixed it. `gh api .../pulls/1255/update-branch` then took the PR
green.
**Why.** Two beads changed `settle` and one of its callers in `effects.rs`; each was green on its own
branch, and `main` has no branch protection (`GET .../branches/main/protection` answers 404), so
neither was re-tested against the other before merging.
**Cost.** One CI cycle (about 20 minutes) and ten minutes diagnosing a failure in code the bead
never touched — the run was still in progress, so `gh run view --log-failed` refused and the job's
steps and annotations had to be read through the API instead.
**Prevent by.** `implement-bead`'s *Red CI* section: before diagnosing a red job, compare it with
main's latest run of the same job (`gh run list --branch main --workflow ci.yml --limit 3`), and if
main is red at the same step, catch up with `update-branch` once main is green rather than spending
a fix attempt.
**Seen before.** ah-jw85 (a signature change broke a concurrent PR's call sites), ah-1wcw.6 (main
red and unnoticed), ah-dhga (main moved under the branch).
