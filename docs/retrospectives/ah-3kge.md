# ah-3kge — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-10-08
- **PR:** #1450 (and rmstdope/cerebro#475)

## The pinned toolchain did not reach the fleet's own sessions

**What happened.** After `rust-toolchain.toml` named 1.99.0, `rustc --version` in the worktree still
printed 1.98.1. `rustup show active-toolchain` answered "overridden by environment variable
RUSTUP_TOOLCHAIN": the session carried `RUSTUP_TOOLCHAIN=stable-aarch64-apple-darwin` and
`RUSTUP_TOOLCHAIN_SOURCE=toolchain-file`, inherited from `cerebro-tui`.
**Why.** The fleet view is started through `cargo run`, which goes through rustup's proxy. The proxy
hands its child the toolchain it resolved for the view's own build, and an inherited
`RUSTUP_TOOLCHAIN` outranks any `rust-toolchain.toml`. cb-6fu's strip in `scripts/launch` cleared
cargo's injections but not rustup's. So the bead's filed cause, an unpinned channel, was only half
of it: on the fleet, even a pinned file is ignored.
**Cost.** One question to the navigator, a scope change into a cerebro PR (#475) with its own review
and CI round, and about forty minutes.
**Prevent by.** Done in this bead: `scripts/cargo-env.sh` strips rustup's toolchain choice, and
cerebro's `.cerebro/traps.md` cargo-environment entry names it. A bead that changes what tool
version a build uses should check `rustup show active-toolchain` (or the tool's equivalent) inside
a fleet session, not only `--version` in a fresh shell.
**Seen before.** ah-4oz9 (the local/CI clippy split this bead was filed from; its cause was left
open).

## Two cerebro tests failed on runs unrelated to the diff

**What happened.** Locally, `bash tests/gate` in cerebro failed
`main_tests::a_released_lease_is_bindable_by_a_successor` ("cannot locate the supervision lease")
while the consumer's `check:fast` was running on the same machine; alone it passed 3 of 3. In CI,
`tests/tracked-links.sh` printed "all assertions passed" and then failed on its cleanup:
`rm: cannot remove '/tmp/.../selfrepo-.../.git': Directory not empty`. It was green locally 3 of 3,
and green on a bare re-run.
**Why.** Not established. The lease test looks load-sensitive. The tracked-links failure looks like
a process still writing into the temp repository's `.git` as the EXIT trap removes it.
**Cost.** One bare CI re-run and about ten minutes.
**Prevent by.** cerebro's `tests/lib/consumer.sh` cleanup could retry `rm -rf` once, or wait for
the suite's children before removing `$work_dir`. The lease test could be bounded on load, not
the wall clock.
**Seen before.** none found.
