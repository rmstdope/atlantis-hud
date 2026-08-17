# ah-j0e — retrospective

- **Implementer:** Storm
- **Date:** 2026-08-17
- **PR:** #387

## An unformatted review fix reached CI, because the local gate could no longer be run at all

**What happened.** `pnpm run check:fast` was green before the PR opened. The Copilot review then
prompted a code change and a new test, at which point `pnpm run check:fast` exited 1 — not on
anything in the diff, but on `scripts/diskPreflight.test.ts`, which shells out to the preflight and
fails whenever the machine is under the 8 GB floor. The machine was at 7.5 GB, all of it held by
other agents' live build trees (`prune-worktrees.sh` correctly reclaimed nothing). Reading that
single failure as environmental, I pushed. CI's `rust` job then failed on `cargo fmt --check` — the
new test was unformatted, which the gate would have caught in its `cargo` suite had it got that far.
One CI cycle to find it, one commit and another cycle to fix it.

**Why.** `check:fast` is one pass/fail, so a fail that is entirely environmental is
indistinguishable at a glance from one that is not, and the honest reading ("this is the disk, not
my diff") is also the reading that skips every step after it. The tooling suite runs before cargo,
so the disk floor masks fmt and clippy specifically.

**Cost.** Two CI cycles, about 20 minutes.

**Prevent by.** When `check:fast` fails only on `scripts/diskPreflight.test.ts`, do not treat the
gate as run. `cargo fmt --check` and `cargo clippy` are seconds each, need no build headroom beyond
what is already warm, and are exactly what that failure hides — run them directly before pushing.
The same applies to any push after the first: a review fix is a code change and wants the gate
again, not just the test it was written for.

**Seen before.** The disk floor itself is recorded in ah-quw, ah-do8.2, ah-s0m, ah-9r0, ah-9lv,
ah-8m0.2 and ah-l2i.1 — seven files, none of which names what it hides downstream of it. That is the
part this one adds.
