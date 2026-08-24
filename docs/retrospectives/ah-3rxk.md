# ah-3rxk — retrospective

- **Implementer:** Storm
- **Date:** 2026-08-24
- **PR:** #660

## A worktree can be built under the disk floor by sharing the main checkout's cargo target

**What happened.** `.claude/cerebro/scripts/disk-preflight` refused the start at 5.1 GB free against
its 8 GB floor. `prune-worktrees.sh` could free nothing (all three trees legitimately held work), and
both reclaims the preflight advertises outside the repository — `~/.cargo/registry/src` and
`~/Library/Caches/Mozilla.sccache` — were refused by the harness's auto-mode classifier, as roughly
two dozen earlier retrospectives already record. `rm -rf target/debug/incremental` inside the repo was
allowed and freed nothing measurable.

Rather than hand the bead back, I ran the whole bead with
`CARGO_TARGET_DIR=<main checkout>/target`. The fresh worktree then reused the existing 1.8 GB target
instead of building a fourth 4 GB one, and `pnpm run check:fast` passed all six stages, cargo
included, in about a minute. Nothing about the bead needed the extra space.

**Why.** The floor is sized for a worktree that builds its own Rust target from cold. A worktree that
shares one needs almost none of it, so the check is measuring the wrong thing for any bead that is
not a first Rust build on this machine. Cargo takes a lock on the target directory, so a concurrent
run from another worktree blocks rather than corrupting anything.

**Cost.** About ten minutes, before the first test was written.

**Prevent by.** Either `disk-preflight` or `prepare-worktree` deciding this rather than each
implementer: a new worktree could export `CARGO_TARGET_DIR` at the main checkout's `target` by
default, which would also stop the fleet holding three or four multi-gigabyte copies of the same
build at once — the 9.5 GB the preflight itself reported here was almost all duplicate targets. That
is a navigator's change to the submodule, not an implementer's.

**Seen before.** The refused `$HOME` reclaims: `ah-87he` ("both `$HOME` reclaims were refused
again"), `ah-udff`, `ah-tdsi`, `ah-9r0`, `ah-y3j1` and about twenty more. The shared-target route out
of it is not in any of them.

## The plan's RED for the last-`from` split could not be written from the fixture

**What happened.** The plan's increment 3 asked for a test asserting that cooking's *second* ` from `
is the one that matters, on the committed fixture. The fixture's cooking entry says ` from ` twice in
the paragraph — "creating provisions from basic foodstuffs" and "rounded up from any of grain" — but
the first sits in the skill's prose, *before* the `may PRODUCE` clause that `PRODUCTION` captures.
Inside the captured segment there is exactly one, so first-split and last-split give identical
answers and the planned test passed against the unchanged code.

**Why.** The bead description and the plan both read the paragraph rather than the captured clause.
The existing test `reads cooking's product from a sentence that says "from" twice` names the same
belief and is likewise green either way.

**Cost.** About ten minutes, and one discarded test.

**Prevent by.** Where a plan names a fixture entry as the RED for a parser change, it should quote
the text *the parser's own capture group sees*, not the paragraph — for `readProduction` that is
`PRODUCTION`'s group 1. The substitute here was a synthetic paragraph of cooking's shape carrying two
` from `s inside the clause, which does fail on the old split.

**Seen before.** None found.
