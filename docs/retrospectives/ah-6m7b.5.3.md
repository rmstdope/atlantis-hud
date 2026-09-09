# ah-6m7b.5.3 — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-09-09
- **PR:** #1130

## Nothing this fleet runs would have caught a `cargo test --release` that does not compile

**What happened.** This bead adds a `debug_assert_eq!` and gates its machinery out of release
builds. My first gating was asymmetric: `compared_silver_rows` was
`#[cfg(any(debug_assertions, test))]`, `silver_records_agree` was `#[cfg(debug_assertions)]`, and
the three new test call sites were gated on neither. Under a release profile the calls resolved to
the enclosing test *module* of the same name:

```
$ cargo test --release -p atlantis-hud-core --lib --no-run
error[E0423]: expected function, found module `silver_records_agree`
```

Three of them, a hard compile error. I had run `cargo check --release`, which passes because it does
not build the test harness, and read that as proof the gating was sound. **Neither
`pnpm run check:fast` nor any of CI's eleven jobs builds tests in a release profile**, so this was
green everywhere and would have stayed green until somebody typed `--release`. The review sub-agent
found it by trying the command; I then reproduced it before fixing.

**Why.** `cfg(test)` and `cfg(debug_assertions)` are independent, and a release test build is the
one profile where they disagree. Nothing in the local gate or CI occupies that corner, and
`cargo check --release` looks like it covers it and does not.

**Cost.** One review round and one fix commit, about twelve minutes. The defect never reached main.

**Prevent by.** Two candidates, both the navigator's call rather than mine:

- `implement-bead`'s *Building* section could say that a diff introducing a `cfg(debug_assertions)`
  or `cfg(test)` gate is checked with `cargo test --release --no-run`, not `cargo check --release` —
  the distinction is the whole of this finding and is not obvious at the moment you need it.
- Or CI could gain a `cargo test --workspace --release --no-run` leg. It is cheap (no tests run) and
  it closes the corner permanently, at the price of one more job.

The narrower first option is probably enough: this only bites a change that adds such a gate, which
is rare.

**Seen before.** None found — `grep -rl "cfg(debug_assertions)\|--release" docs/retrospectives/`
returns only `ah-6m7b.5.2.md`, which is this bead's parent discussing the `debug_assert` itself and
not its gating.
