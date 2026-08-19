# ah-csni — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-08-19
- **PR:** #462

## The apt stall in `Install the Playwright browser` cost two re-runs, again

**What happened.** The first CI run failed `smoke (web, 1, 2)`, `smoke (web, 2, 2)` and `pwa`, all
three cut at ~15m in `Install the Playwright browser` before a single test ran. The log shows apt
crawling the Azure mirror — `fonts-freefont-ttf` at 16:48:07, `fonts-unifont` at 16:54:53,
`fonts-wqy-zenhei` at 16:58:56, then cancellation. A re-run of the failed jobs cleared both smoke
shards; `pwa` stalled identically a second time and needed a third run to pass.
**Why.** GitHub Actions' Ubuntu apt mirror, unchanged from the eight sightings before this one.
Nothing in the diff touched CI, and every job passed once it got past that step.
**Cost.** About 50 minutes of wall-clock and two re-runs. No diagnosis time — `ah-3c80`'s
retrospective named the shape exactly, so recognising it took one log read.
**Prevent by.** `ah-f9q9` (the pinned Playwright container) removes the exposure rather than
bounding it. `ah-3c80` already argued its priority should rise on three sightings in one hour; this
run is three more, on a different bead a day later, and is worth reading as such when it is triaged.
The 15-minute ceiling from `ah-3c80` did its job — the jobs died at 15m rather than 25–55.
**Seen before.** ah-3c80 (which names ah-k6i.5, ah-bn6.1, ah-mjy, ah-vw63) — all the same step.
