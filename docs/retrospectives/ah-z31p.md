# ah-z31p — retrospective

- **Implementer:** Storm
- **Date:** 2026-08-24
- **PR:** #658

## The same three local-only smoke failures cost a second stash-and-rerun

**What happened.** `pnpm run test:smoke` reported five failures, among them
`workspace.spec.ts › the faction view uses the window before it scrolls` and
`› a planned route can be written into the unit's orders`, in both the `web` and `desktop-shell`
projects. None was map-related, but the bead's plan asked for the smoke suite specifically, so the
result had to be attributed rather than assumed. I re-ran the two named specs, then stashed the whole
change with `git stash -u` and re-ran them against the unmodified base: both failed identically
there. All four smoke shards then passed in CI on the same commit.
**Why.** Not established, and it is the same open question `ah-o2li` left: the faction-view spec is
about viewport height and this machine's headless window is presumably not the runner's. Not proved.
**Cost.** About forty minutes — one 18-minute full suite, two targeted re-runs at ~4 minutes each,
plus the stash cycle. The bead's own work took less.
**Prevent by.** `ah-o2li`'s *Prevent by* is unchanged and now has a second bead behind it: have
`implement-bead`'s *Building* say to run only the specs a bead actually touches
(`pnpm exec playwright test <file> --project=web -g "<name>"`), never the whole suite, since CI runs
the rest anyway. A second clause would have helped more here: a plan that asks for the full smoke
suite — this one did, reasonably, since these effects only execute in a browser — should say which
specs it means, so the implementer is not left attributing failures across the whole file.
**Seen before.** `ah-o2li` §*A smoke test failed locally three times and passed in CI* — the same
faction-view spec, same stash-and-rerun, ~15 minutes. `ah-bkjd`, `ah-brgo.1`, `ah-2a96` and
`ah-9ess` all name one of these two specs as well. This is its sixth recorded sighting, and the
second where the whole cost was attribution rather than a defect.
