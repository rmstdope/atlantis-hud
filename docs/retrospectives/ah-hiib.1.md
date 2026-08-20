# ah-hiib.1 — retrospective

- **Implementer:** Storm
- **Date:** 2026-08-21
- **PR:** rmstdope/cerebro#62, and this one

## The concurrency test failed on the state file, not on the log it was written to pin

**What happened.** The plan's increment 4 (`concurrent writes leave whole lines`) predicted GREEN
with no code change, and said that if it failed the transition line was being written in more than
one `write`. It failed for an unrelated reason. The test as first written ran twenty parallel
`agent-state Cyclops …` calls; eleven of them died with
`mv: rename …/Cyclops.state.json.tmp to …/Cyclops.state.json: No such file or directory`.
The transition log was fine — only seven lines existed because most invocations had already aborted
under `set -e` before reaching the append.

**Why.** `scripts/agent-state` writes its state file to a fixed `"$out_file.tmp"`
(`agent-state:121`). Two concurrent invocations *for the same agent name* share that path, so one
`mv`s the file out from under the other. That is a pre-existing race in the state file's write, not
in this bead's log, and it is invisible in normal operation because one agent name is written by one
session at a time. The test was rewritten to use ten distinct roster names, two calls each — still
twenty concurrent appends to the one shared log, which is what the increment was pinning — and
passed unchanged.

**Cost.** About ten minutes, one wrong diagnosis considered (a split `write`), no CI cycle.

**Prevent by.** Two things. A plan that predicts "GREEN: nothing" for a test should say what the
test must *not* also exercise — here, that concurrency on the shared log must be driven by distinct
agent names, since the per-agent state file is not concurrency-safe. And `agent-state`'s tmp path
is worth making unique (`$out_file.$$.tmp`) in a bead of its own; it is out of scope here, which
this bead's *Out of scope* is explicit about, but the race is real and now written down.

**Seen before.** none found.
