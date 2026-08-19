# ah-vzj9 — retrospective

- **Implementer:** Storm
- **Date:** 2026-08-19
- **PR:** #473

## A comment-only change to ci.yml ran the full native suite, and its apt step stalled twice

**What happened.** This bead's diff is nine comment lines in `.github/workflows/ci.yml` and nothing
else. The `changes` filter counts a workflow file as a `native`-shaped path, so `native` ran in
full. Its `Install system dependencies` step (`sudo apt-get update` + `apt-get install`) sat in
`in_progress` for the whole 30-minute `timeout-minutes` ceiling and the job was cancelled. The
re-run reached the same step and took roughly 28 minutes there before completing; everything after
it passed on the first attempt. The seven other checks were green within four minutes both times.

**Why.** The apt stall class `ah-3c80` measured (25–55 minutes, four times in five days). `ah-f9q9`
removed apt from `smoke` and `pwa` by moving them onto the Playwright image; `native` still runs it,
so the stall class survives there untouched. That a *documentation* change pays it is the second
half: the `changes` filter cannot tell a comment in `ci.yml` from a workflow edit that alters what
runs.

**Cost.** About 75 minutes of wall-clock and one re-run, on a change that could not fail. The rest of
the bead took under ten minutes end to end.

**Prevent by.** Two separate things, both the navigator's to weigh, neither in this bead's scope:
(a) `native`'s apt step is the last one on the measured stall path — `ah-f9q9`'s argument for a
prebuilt image applies to it unchanged; (b) the `changes` filter treats any touch of a workflow file
as a code change, which is right for a workflow edit and wrong for a comment. A plan that expects a
workflow-file PR to behave like a docs PR is relying on the opposite.

**Seen before.** `ah-3c80` — same step, same stall, measured there and bounded with
`timeout-minutes`. This is the first record of it on `native` after `ah-f9q9` cleared the other jobs.

## The plan's validation asked for a sample this PR could not provide

**What happened.** The plan's *Validation* step 2 said to read this PR's own `smoke` shard durations
as a third sample of the docs-path cost, expecting ~30s each, and to correct the recorded figures if
they came in materially different. They came in at 3–4 minutes each — because, per the finding
above, this PR is not on the docs path at all: touching `ci.yml` sets `code == 'true'`, so the shards
ran the actual suite rather than pulling the image and skipping. The plan also expected `pwa` to
report as a sample; `pwa` carries a job-level `if:` and pays nothing on a genuine docs PR either way.

**Why.** The plan reasoned from "this change is prose" to "this PR is a docs-only PR". The `changes`
filter reasons from the path, not the content.

**Cost.** No rework — the recorded figures come from #461 and #467 and stand. It cost the time to
establish that the durations were not evidence against them, and the numbers were nearly taken as a
reason to edit a correct comment.

**Prevent by.** When a plan names the PR's own CI run as a measurement, it should state which
`changes` outputs that PR will set. For anything under `.github/`, that is `code == 'true'`.

**Seen before.** None found.
