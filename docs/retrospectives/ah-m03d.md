# ah-m03d — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-09-07
- **PR:** #1035

## A new script's CLI entry point could not run at all, and the whole gate was green

**What happened.** The bead moved a deploy check out of `deploy.yml` into `scripts/manifestCheck.ts`
and had the workflow call it with `pnpm exec tsx scripts/manifestCheck.ts "$site"`. The CLI block
used a top-level `await`. There is no `"type": "module"` above `scripts/`, so `tsx` transforms these
files as CJS and esbuild rejects it outright:

    $ pnpm exec tsx scripts/manifestCheck.ts "https://example.com"
    ERROR: Top-level await is currently not supported with the "cjs" output format

`pnpm run check:fast` was green throughout — 258 tests, including four asserting the workflow now
contains that exact command line. Every test imported the module; none executed it. The bug was
found by the review sub-agent, which ran the command. Had it merged, a deploy job that failed about
half the time would have failed every time, with a worse message than the one the bead set out to
remove.

**Why.** The plan specified the module's exported surface in detail and specified the CLI block only
as "guarded exactly as `scripts/checkGenerated.ts:173-174` guards its own", and stated that the CLI
block is not covered by tests, matching the neighbours' convention. That convention is sound for a
script whose caller is another script, and wrong for one whose only caller is a workflow line: the
entry point *is* the deliverable here, and the plan's own increment 4 tested that the workflow calls
it rather than that the call works. I followed both faithfully and copied the guard without running
what it guards.

**Cost.** No CI cycles — the gate never went red. One review round and about fifteen minutes, all of
it inside the loop that is meant to catch this. The real cost is what it would have been: a broken
deploy check shipped under a green gate.

**Prevent by.** When a bead's deliverable is a new executable entry point, run it once by hand before
opening the PR, and give it one subprocess test — spawn it exactly as its real caller does and assert
the exit code. `implement-bead`'s *Building* section could say this in a line: a test that asserts a
workflow *contains* a command is not evidence the command runs. The "CLI blocks are uncovered here"
convention should be read as applying to scripts invoked by other scripts, not to one whose only
caller is outside the repository's test reach.

**Seen before.** None found — `grep -il "top-level await" docs/retrospectives/` returns nothing.
