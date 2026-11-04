# ah-um2tg — retrospective

- **Implementer:** Storm (resuming Cyclops's hand-back)
- **Date:** 2026-11-04
- **PR:** #1919

## A one-test Rust PR was handed back because the desktop-shell job never got a runner

**What happened.** On head 3d1be7bd every required check passed except desktop-shell. That job was
cancelled after about 15 minutes with no runner assigned and no steps run, once on the first run
and again on both re-runs (job 126655699598, run 41853461578). GitHub's annotation said: "The job
was not acquired by Runner of type hosted even after multiple attempts", and "Due to capacity
constraints, jobs targeting macOS arm64 runners may experience longer queue times." Cyclops spent
the bead's two bare re-runs on it, then handed the bead back with `human`. Later the same head went
green with no change, and the navigator unparked it for a producer to merge.

**Why.** GitHub's hosted macOS arm64 capacity. Nothing in the change or the suite caused it.
*Red CI*'s budget counts a job that never started the same way as a test that failed, so a runner
outage used up the re-runs that are meant for flaky tests.

**Cost.** One hand-back and one navigator decision, about two hours of wall-clock, and a second
producer session to merge a PR that had been ready the whole time.

**Prevent by.** In `produce-bead` *Red CI*, separate "job never acquired a runner" (cancelled, no
runner name, no steps) from a red check. Wait on that case with a longer clock instead of spending a
re-run on it, and hand back only once that wait runs out.

**Seen before.** None found.
