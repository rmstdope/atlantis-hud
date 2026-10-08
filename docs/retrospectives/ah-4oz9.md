# ah-4oz9 — main failed clippy locally right after merging green

## Main red under the local gate, green in CI

**What happened.** After the second rebase of PR #1433, `pnpm run check:fast` failed its clippy leg
on a file this bead never touched: `clippy::needless_borrow` at
`crates/core/src/orders/effects.rs:1336`, introduced by ah-0x6x (#1432). #1432 had merged green, so
CI's clippy accepted the line that this machine's clippy (rustc 1.98.1) refused.

**Why.** Not established. `rust-toolchain.toml` pins `channel = "stable"` and CI installs
`dtolnay/rust-toolchain@stable`, so the local and CI clippy can be different stable releases. A lint
that is newer, or tightened in the newer release, then passes on one side and fails on the other.

**Cost.** One failed gate run (about ten minutes), a gate re-run, and a fix commit unrelated to the
bead riding on its PR. My chained command also pushed the head that had failed the gate before I
had read the result.

**Prevent by.** Pin an exact toolchain version in `rust-toolchain.toml` (e.g. `channel = "1.98.1"`)
and have CI read that file instead of `@stable`, so the local clippy gate and CI's clippy agree.

**Seen before.** No earlier retrospective records it.
