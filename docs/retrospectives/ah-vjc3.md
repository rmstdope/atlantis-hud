# ah-vjc3 — a bug bead filed against a build that main had already moved past

**What happened.** The bead reported that the Long order column kept '@STUDY OBSE' after MOVE N,
as seen at origin/main d3b8112c (12:14). ah-5we4 (#1686), "the Long order column shows the
month-long order that runs", fixed exactly that at 12:37, and the bead was filed at 12:59. The
reproduction walk on current main showed nothing to fix. The bead ended as a regression-test PR
on the navigator's choice.

**Why.** The verifier records the build it verified on, but nothing compares that build with main
before a follow-up bug bead is filed. A bug bead also carries no sha that the bugfixer is told to
diff against before starting.

**Cost.** One bugfix pass, about an hour: rules lookups, a wasm build and two Playwright probes
before `git log d3b8112c..origin/main` on the touched files found the fix. That one command,
run first, would have answered it in seconds.

**Prevent by.** In `fix-bug` step 1, for any bead naming the build it was seen on, run
`git log <that sha>..origin/main --oneline -- <files the claim touches>` before choosing a test.
A fix found there goes straight to the navigator's close-or-pin question.

**Seen before.** `ah-ycuj` was a bead whose divergence `ah-abwx` had already fixed. There the
plan knew it, and the cost was a test with no teeth, not a whole pass. `ah-m9q.2-verifier`
records a verifier misled by a stale build, the same shape from the other side.
