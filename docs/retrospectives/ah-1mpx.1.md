# ah-1mpx.1 — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-08-27
- **PR:** #744

## A store whose `status` an effect depends on cannot move `status` from inside that effect's own work

**What happened.** The plan wired the Armies refresh as an `AppShell` effect keyed on
`[client, game, parsed, armiesStatus]`, and specified `refreshFor`'s failure path as "logged and
swallowed". I deviated: a bare log leaves the cache showing snapshots that were never written, and
because `refreshedAgainst` then finds nothing changed, the next refresh never retries — a silent,
permanent divergence between cache and storage. So I repaired the cache by calling the store's own
`load` in the catch.

That closed a loop. `load` sets `status` `ready` → `loading` → `ready`; the effect is keyed on
`armiesStatus`; the reloaded (stale) cache still differs from the same `parsed`. A write that keeps
failing — a full disk, an exhausted IndexedDB quota — therefore refreshes, fails, reloads and
refreshes again without bound, re-listing and re-logging each time. Both of my tests passed: they
drove the store directly, and the effect that closes the cycle lives in a package with no jsdom and
cannot be rendered there. The Copilot review found it by reading the dependency list against the
catch block, and named both the file and the line.

**Why.** Established. `armiesStatus` is in the effect's dependency list *on purpose* — the plan
argues for it correctly, since the load is asynchronous and Armies arriving late must still be
refreshed against the turn on screen. That makes `status` an input to the effect, and my catch made
it an output of the same effect's work. Nothing in the plan, the skill or the repository's traps
says that a store field read as an effect dependency is thereby off-limits to the work that effect
drives, and the local test suite structurally cannot catch it: `packages/shared` has no jsdom
(ah-nass), so the store is testable and the cycle through the effect is not.

**Cost.** One review round and one CI cycle, about 25 minutes. Nothing reached main.

**Prevent by.** Two things, both concrete:

1. **A plan that puts a store field in an effect's dependency list should say so in *Known traps*** —
   "`armiesStatus` is an input to this effect, so nothing `refreshFor` does may write `status`". The
   plan's *Where the refresh is called* section explains at length *why* the dependency is needed
   and never states the obligation that follows from it. That sentence would have stopped the
   deviation as I wrote it.
2. **Test the constraint, not the cycle.** The fix is pinned by subscribing to the store across the
   call and asserting every observed `status` is `ready` and `listArmies` was never called
   (`armiesStore.test.ts`, "neither re-lists nor moves status when a save fails"). That is a test a
   jsdom-free package *can* run: it asserts the invariant the effect relies on, rather than trying
   to observe the loop. Where a plan makes a store field an effect dependency, this is the shape of
   test to ask for.

The fix itself keeps the repair and drops the reload: the saves go through `Promise.allSettled`, and
only the Armies whose write was rejected are put back from the pre-refresh list. `refreshFor` no
longer touches `status` at all, so the cache matches storage exactly whatever partially succeeded,
with no cycle to break.

**Seen before.** `ah-teg0` — the nearest, and a different shape of the same family: there a value
was normalised where it was read, which broke an effect keyed on that value's *identity*. This one
is a feedback cycle rather than identity churn, but both are an effect's dependency list being
reasoned about separately from the code that changes what it depends on.
