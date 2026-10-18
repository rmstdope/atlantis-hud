# ah-iauy — the order checks run in the core's worker

## Under a 6x CDP CPU throttle, the timer-gap sampler cannot see below about 140ms

**What happened.** The bead's acceptance is "no single main-thread task of the checks longer than
about 50ms under a 6x CPU throttle". After the checks moved into a worker, the smoke guard's
timer-gap sampler (the same one the report-load guard uses) still read 140-220ms under
`Emulation.setCPUThrottlingRate {rate: 6}`, and the largest gap ended exactly when the worker's
answer arrived, which looked like the main thread still doing the checks' work.

**Why.** It was the throttle, not the checks. The same page reads 130-150ms gaps with a dummy
worker idle *or* busy, so that figure is the throttled page's own floor. Timing the main thread's
part directly showed posting the two requests takes under 1ms, receiving the two answers (42KB and
59KB of JSON) takes 2-4ms, and no `longtask` entry falls between asking and answering.

**Cost.** About forty minutes of throwaway instrumented specs and CPU profiles: a Worker prototype
patch, a timer wrapped around the main thread's queries, and a dummy-worker control run.

**Prevent by.** In `tests/smoke/workspace.spec.ts`, the comment on "the interface is not blocked
while the orders are checked" now records the floor. When a bead's acceptance names a millisecond
figure under a CDP throttle, its plan's *Validation* should measure by attribution (time the
main-thread side of the work, and read `longtask` entries) and not with the gap sampler, or else
first measure the sampler's floor with the work idle.

**Seen before.** No. The report-load guard was calibrated on unthrottled CI runs, so the floor
never showed up there.
