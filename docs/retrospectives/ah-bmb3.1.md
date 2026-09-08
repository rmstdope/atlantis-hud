# ah-bmb3.1 — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-09-08
- **PR:** #1070

## `study-planner.spec.ts` "a note is kept without pressing anything" flaked again — second sighting in a day

**What happened.** CI's `smoke (web, 1, 2)` failed at `tests/smoke/study-planner.spec.ts:341`, the
note textarea holding `"heading for Gate Lore"` where the spec expects
`"heading for Gate Lore, then Portals"` — the same test, the same line and the same two values as
`docs/retrospectives/ah-lcs1.md` recorded hours earlier on a different shard. This bead's diff is a
single Rust file in `crates/core-persistence`, and `crates/core-wasm/Cargo.toml` depends only on
`atlantis-hud-core`, so the web bundle never compiles the changed crate at all: the failing job
cannot reach this diff by any path. Running the one spec locally
(`pnpm exec playwright test --project=web tests/smoke/study-planner.spec.ts -g "a note is kept without pressing anything"`)
reported `1 flaky` — failed, then passed on retry — which is the same signature ah-lcs1 measured
against unmodified `origin/main`. One re-run of the failed job was green.

**Why.** As ah-lcs1 established: the spec races its own 400ms `STUDY_NOTE_AUTOSAVE_MS` debounce by
design, and two CDP round-trips inside that budget is not reliably generous on a loaded machine or
a CI runner. Nothing new was learned about the cause here; what is new is that it is now on its
second independent bead, on a different Playwright project (`web`, where ah-lcs1 saw
`desktop-shell`), so it is neither shard-specific nor shell-specific.

**Cost.** One CI cycle and about fifteen minutes — much less than ah-lcs1's thirty-five, because
that retrospective existed to be found. The `grep -rl` the skill asks for before writing *Seen
before* is what turned a suspected regression into a known flake in one command.

**Prevent by.** ah-lcs1's own `Prevent by` still stands and is the navigator's call: the spec wants
a deterministic hold on the debounce rather than a 400ms budget for two round-trips. What this
second sighting adds is that the fact has earned a place in `.cerebro/traps.md` — a red
`smoke (…)` job on this one test name is a flake until proved otherwise, whatever the shell or
shard — so that the next implementer meets it at the top of its work rather than after a CI cycle.
Proposing that entry is Forge's and the navigator's, not an implementer's.

**Seen before.** `ah-lcs1` — same spec, same line, same expected and received values, different
Playwright project.
