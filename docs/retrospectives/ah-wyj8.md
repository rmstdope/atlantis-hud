# ah-wyj8 — retrospective

- **Implementer:** Nightcrawler
- **Date:** 2026-10-08
- **PR:** #1425

## A red fast gate was committed and pushed because its status was piped through `tail`

**What happened.** `pnpm run check:fast 2>&1 | tail -1 && git add -A && git commit ... && git push` committed and pushed `e014cd72` while the gate had failed (`ELIFECYCLE Command failed with exit code 1`). Only reading the saved output afterwards showed the failure.
**Why.** Established: a pipeline's exit status is the last command's, so `&&` tested `tail`'s 0, not the gate's 1.
**Cost.** One push of an ungated head and a second full gate run (about 10 minutes under load) to find which leg failed. The failure turned out to be a load timeout, but that was not known when the push happened.
**Prevent by.** `skills/produce-bead/SKILL.md` *Building*: state that the fast gate's own exit status is what licenses the commit, and give the form to use: `pnpm run check:fast > <log> 2>&1; echo exit=$?`, then commit only on `exit=0`. Never pipe the gate into `tail` inside an `&&` chain.
**Seen before.** ah-60w, ah-4ue, ah-qled.10.2: the same `| tail` masking, each time on a different command.

## The movement trace places a unit whose MOVE a later STUDY replaced, and only the smoke suite showed it

**What happened.** All unit tests passed. CI's smoke `orders-editor.spec.ts` ("orders written before the setting was on are tidied ...") then failed: unit 18642 (`move n` / `study combat`) gained a silver warning button that broke a row locator. `effects::shipment_measures` returns `month_end` (7,51) for it, although the checker says "STUDY replaces this MOVE ... so this MOVE will not run".
**Why.** Established: `movement::chain::RouteChain` keeps a replaced MOVE's route on purpose (`a_trailing_month_long_order_leaves_the_route_standing`), and `month_end_of` records where that route ends. Every unit test in `semantics.rs` fills `CheckOptions::month_end` by hand, so none of them exercises the trace. This bead was the first to make a walking sharer's silver depend on it.
**Cost.** One CI cycle (about 12 minutes), a diagnosis on a real fixture, and a further fix and review round inside this bead (`SharingReach::ends_at` now believes the trace only while the effective intents still walk). Follow-up ah-osny covers the shipment measure, which still reads the unfiltered trace.
**Prevent by.** A `semantics.rs` test helper that derives `month_end` from `effects::shipment_measures` on the orders it checks, instead of a hand-filled map, used by the tests of every `SharingReach` consumer. Until ah-osny lands, the doc on `CheckOptions::month_end` should say that it follows every MOVE written, including a replaced one.
**Seen before.** None found: `grep -rl "RouteChain\|replaces this MOVE\|trailing month-long" docs/retrospectives/` was empty.
