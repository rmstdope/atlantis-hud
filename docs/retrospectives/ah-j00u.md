# ah-j00u — retrospective

- **Implementer:** Storm
- **Date:** 2026-08-23
- **PR:** #609

## The plan's validation command named a crate that does not exist

**What happened.** The plan's *Validation* section says `cargo test -p atlantis-core`. That exits
non-zero with `package ID specification 'atlantis-core' did not match any packages`: the package in
`crates/core/Cargo.toml` is named `atlantis-hud-core`. The same wrong name appears twice more, in
the plan's *Increments* and *The test plan* sections.
**Why.** The directory is `crates/core`, and the plan's author derived the package name from the
path rather than from `Cargo.toml`. Every crate here is prefixed `atlantis-hud-`.
**Cost.** About a minute — one failed command and one `grep` of `Cargo.toml`. Trivial here because
the failure names its own cause; it is recorded because a plan naming a command that cannot run is
cheap to prevent and the fleet reads plans literally.
**Prevent by.** `plan-bead` should require that any `cargo -p <name>` in a plan's *Validation* be
copied from the crate's `Cargo.toml` `name` field, not from its directory. A planner writing a Rust
suite command can check it with `grep -m1 '^name' crates/<dir>/Cargo.toml`.
**Seen before.** none found.

## disk-preflight blocked the start for ~50 minutes and could not be cleared from inside the session

**What happened.** `disk-preflight` refused the start at 7.0 GB free against its 8 GB floor. Its own
suggested reclaims (`rm -rf ~/.cargo/registry/src`, `target/debug/incremental`, the sccache
directory) were refused by the permission classifier, as was `prune-worktrees.sh`. The only large
consumers were two live agents' worktrees, which must not be touched. I polled for ~50 minutes,
during which free space first fell to 4.1 GB (the other agents building) and then recovered to a
plateau of ~7.3 GB — still under the floor. The navigator settled it twice: first "you free space, I
wait", then "proceed anyway". The bead built and gated fine on 7.3 GB, as expected for a two-file
documentation change.
**Why.** Established for the block, not for the classifier: the machine genuinely had less than the
floor, and the reclaimable space (~104 MB in `~/.cargo/registry/src`) was two orders of magnitude
short of what a plateau at 7.3 GB needed. Why the classifier refused the preflight's own suggested
commands was not established.
**Cost.** About 50 minutes of wall-clock and two navigator interruptions, for a bead whose whole
diff is a doc comment and one assertion.
**Prevent by.** Two separable things. (1) `disk-preflight`'s advice is unusable if an agent cannot
act on it — the safe reclaims should be a script under `.claude/cerebro/scripts/` that the
permission rules allow, rather than `rm -rf` lines in prose. (2) The 8 GB floor is sized for a full
Rust build; a bead that touches no compiled surface does not need it. `implement-bead`'s *Workspace*
section could let the preflight take the expected build weight, or let an implementer record the
shortfall and proceed when the plan's own *Files to change* names no crate source.
**Seen before.** `docs/retrospectives/ah-y3j1.md`, `ah-udff.md`, `ah-9r0.md`, `ah-tdsi.md`,
`ah-8m0.2.md` all mention `disk-preflight` — this is at least the sixth sighting.
