# ah-i2t2 — retrospective

- **Implementer:** Storm
- **Date:** 2026-09-22
- **PR:** #1305

## The declared Rust workload did not make the fast gate run Rust checks

**What happened.** The plan declared a Rust workload because `generate:bindings` invokes Cargo and
said `pnpm run check:fast` would run formatting and Clippy. The changed paths classified as
`non-rust`, so the fast gate skipped both; I ran `cargo fmt --check` and
`cargo clippy --workspace --all-targets -- -D warnings` directly before merge.
**Why.** `scripts/runGate.ts` chooses Rust legs from changed paths, not from a plan's declared
workload or the commands used earlier in the validation sequence.
**Cost.** One additional direct Clippy run, about a minute of wall-clock time.
**Prevent by.** In `plan-bead` validation, require direct Rust checks when a plan's regeneration
command invokes Cargo but its changed paths classify as non-Rust.
**Seen before.** ah-sooy covers the same path-based workload classification, although its symptom
was an unnecessary Rust test run rather than skipped Rust checks.
