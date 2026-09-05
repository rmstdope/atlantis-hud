# ah-lyg6.2.3 — retrospective (the reopened pass)

- **Implementer:** Storm
- **Date:** 2026-09-05
- **PR:** #992

## I argued a defect away twice, from evidence that did not support it

**What happened.** The review found that the cell dropdown's focus effect, keyed on the step alone,
left focus on the grid when a dropdown moved to a second cell. I fixed the keying but dropped the
regression test, on the grounds that the path was unreachable: my smoke attempt at it failed with
Playwright's `study-schedule-popover intercepts pointer events`, and I read that one covered cell as
proof that no route existed. It is not — the next round pointed out `Shift+Tab`, which leaves the
dropdown for a grid cell in one press because there is no focus trap (`dismissLayer.ts` handles
Escape alone). The test that resulted, written that way, passes and fails exactly as it should. I did
the same thing a round later: told the review that a lost-plan symptom was "the test not waiting",
having watched two settle-assertions make it green, when a real defect was underneath.

**Why.** Both times a *sufficient* explanation arrived before a *complete* one, and both times the
sufficient one was the cheaper conclusion — it let me keep a fix I had already written and skip a
test I had already failed to write. A tool's refusal is evidence about the call that was made, never
about the set of calls that were not.

**Cost.** Two extra review rounds, about twenty-five minutes, and — more to the point — a defect that
would have shipped: the second half of the argument turned out to be a genuine data-loss bug (below).

**Prevent by.** `implement-bead`'s *Answering it, and going on* asks for "a change or a posted reply
saying why not". Where the reply is *"the finding does not apply"* rather than a judgement call, it
should have to name the evidence that rules the case out and say what would falsify it — "Playwright
refused one click" does not rule out a keyboard route, and "the test is green now" does not rule out a
defect. A reply that cannot name what it checked is a reply that should be a change instead.

**Seen before.** `ah-zh5i.4` and `ah-7cdt` — both are a generalisation from what was observed to what
is true, which is the same shape.

## Two plan choices in quick succession lost one, and the store's shape was why

**What happened.** Clicking two schedule cells fast enough lost the second across a reload,
repeatably in the smoke suite. `studyPlansStore.save` took a finished `StudyPlanRecord`, wrote it,
and updated its cache only when the write resolved. A plan is **one row whose goals are written
whole**, so a second choice made while the first write was in flight was built from a row that did
not hold the first, and — being last — overwrote it. My first fix serialized the writes, which
ordered them and left the payloads stale; the review caught that it made the loss *deterministic*
rather than fixing it. `save` now takes the key and an edit and applies the edit inside the queued
write, against the row the cache holds when the write runs.

**Why.** The store's write-first design predates one-click planning. Under `ah-lyg6.2.3`'s own
verification-failed design a plan took a form and a `Set`, so two writes could not overlap in
practice; the redesign this bead delivers makes a choice one click, and the hazard became reachable
by ordinary use. The defect was latent in `ah-lyg6.2.1`'s store, not introduced here.

**Cost.** Two review rounds and about forty minutes, most of it spent believing a flaky smoke test.

**Prevent by.** A plan that changes how often a stored thing is written should say so, and name the
store it writes through. This plan's *Where state lives* section named `useStudyPlansStore` and said
"Nothing in this bead touches it" — true of the code and false of the load it puts on it. A line in
that section asking whether the new interaction changes the *rate or concurrency* of writes would
have put this in front of the planner rather than in front of a flaky test.

**Seen before.** None found for this store.

## Left for the navigator, not fixed here

Two things the review raised that are outside a planned bead, recorded so they reach a person:

- **`studyPlansStore.load` is not queued** and can publish a row set that omits a write still in
  flight. Pre-existing; this bead is what makes write ordering a stated property of the file.
- **An open cell dropdown is Tab-escapable into the grid**, with no focus containment and no
  outside-click dismissal. Whether it should be is a user-facing question for the plan.
