# ah-jw85 — retrospective

- **Implementer:** Rogue
- **Date:** 2026-08-25
- **PR:** #700

## A signature change on a shared function broke a concurrent PR's new call sites, and the failure looked like CI infrastructure at first

**What happened.** After the Copilot review and its fix landed, every CI job failed within
20-70 seconds with `error[E0061]: this function takes 3 arguments but 2 arguments were supplied`
at `crates/core/src/orders/semantics.rs:1654`, naming a `Hex::read(region, &ordered)` call this
branch's own committed source did not contain — confirmed with `git show <sha>:...` against both
the local clone and a fresh `git clone` from GitHub. That mismatch, plus every job failing at
nearly the same short duration, first read as a GitHub Actions cache or checkout problem, since
`actions/checkout`'s default `pull_request` behavior builds the synthetic merge-of-main ref rather
than the branch's own HEAD.

**Why.** It was not infrastructure. `main` had gained a commit (`ah-agbm`, #697) since this branch
forked, adding its own new usage of `Hex::read` — a function this bead changed from two arguments
to three. Git's merge of that commit with this branch is textually clean (the two PRs touch
different regions of `semantics.rs`), so `mergeStateStatus` read `MERGEABLE` rather than
`CONFLICTING` and gave no warning. But a clean text merge does not make a *compiling* merge: the
new call site from `#697`, untouched by this branch's diff, still passed only two arguments to a
function that now needs three. GitHub's `pull_request`-triggered checkout builds exactly that merge
snapshot, which is why the "checks"/"wasm" jobs (library-only builds) saw one instance of the error
in production code (`item_effects`) and the "rust" job (`clippy --all-targets`, which also compiles
`#[cfg(test)]` code) saw a second, in a test helper `#697` had also added.

**Cost.** About 25 minutes: two CI runs before the mismatch was traced to its real cause (an
`--all-targets` clippy re-run, a fresh clone to rule out a bad local commit, and a byte-for-byte
diff of `Hex::read` call sites between the branch's fork point and `main`'s tip to find both new
sites), then a merge and one fix commit.

**Prevent by.** Nothing to change in the workflow or the skill: this is exactly the "BEHIND" case
`implement-bead`'s *Merging* section already describes — "two agents changing the same function
compatibly is exactly what this catches" — and the fix was the one the skill already names
(`git fetch origin main && git rebase origin/main` or, as here, a local merge, then resolve and
push). What cost the 25 minutes was not recognizing the pattern immediately: a compile error naming
content absent from the branch's own committed blob, on a `pull_request`-triggered job specifically,
is the fingerprint of a merge-with-main failure rather than a broken commit or a flaky runner. A
future run hitting the same shape can skip the infrastructure detour and go straight to
`git log HEAD..origin/main --stat` for the file the error names.

**Seen before.** None found.
