# ah-g9sf.11 — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-09-11
- **PR:** #1175

## A rebase conflict resolution left stale helper calls that only the rebased CI build found

**What happened.** The final pre-rebase `pnpm run check:fast` passed on `5599762c`. Rebasing onto
main required resolving a conflict where `read_intents_with_ruleset(source, ruleset)` was combined
with DESTROY/PROMOTE metadata parsing. The resolved branch `c4885f0e` was pushed, but CI run
`34655187642` failed: `cargo fmt --check` found indentation left by the resolution, and the WASM
build found two-argument calls to `grammar::consumed_arguments` even though main's API now requires
the third `Option<&Ruleset>` argument. Passing the ruleset through those helpers and formatting
the destructuring fixed the failures in `b84651c8`; the targeted core tests and subsequent CI run
then passed.

**Why.** Established. The rebase combined the ruleset-aware intent reader with the branch's
metadata helpers, but the helper signature changes were not updated in every call site during
conflict resolution. The formatter issue was also introduced by the resolved destructuring.

**Cost.** One full CI cycle, one fix commit, one delta review, and the associated wait for the
rebuilt checks.

**Prevent by.** After resolving a rebase conflict that changes a shared function signature, run
`cargo fmt --all -- --check` and compile the affected Rust/WASM targets before pushing, then search
for every call to the changed helper (`consumed_arguments` here). This catches cleanly merged
stale call sites that conflict markers cannot identify.

**Seen before.** `ah-oq3` — a rebase left a tuple-arity mismatch that git did not flag;
`ah-jw85` — a shared signature change broke concurrent call sites; `ah-ofpb.5` — textual conflict
resolution left invalid syntax that compilation caught.
