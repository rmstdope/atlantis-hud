# ah-agbm — retrospective

- **Implementer:** Wolverine
- **Date:** 2026-08-25
- **PR:** #697

## The plan's regression net named two tests as unedited that its own design increments broke

**What happened.** The plan's *Files to change* section listed
`giving_the_unit_itself_previews_nothing` and `giving_a_class_of_items_previews_nothing` among "the
regression net, all unedited and all of which must stay green." Both tests asserted that
`GIVE 901 UNIT` and `GIVE 901 ALL ITEMS` produced an **empty** preview response. Building increment 2
exactly as the plan's own "Where each recording goes" table specified — `transfer`'s two reachable
`doubted.insert` arms also record `uncounted`, unconditionally, for "a whole class or `GIVE x UNIT`"
— made both orders reach the response instead, carrying the new S1 mark. That is also what Round 1
Q2 of the navigator interview names as the worked example of an uncountable order. `cargo test`
caught the contradiction immediately: both tests failed the moment increment 4's filter change
(`&& uncounted.is_empty()`) let a zero-`changes` unit through.

**Why.** The regression-net list was written (or copied) before, or without cross-checking against,
the increment 2 design decision that gates `uncounted` on the *selector* failing rather than on
`RecordMovement`. The two are in the same document but were not reconciled against each other.

**Cost.** About fifteen minutes: confirming the failure was the new design working as specified
rather than a bug, re-reading Round 1 Q2 and the recording table to be sure the navigator had
actually chosen this outcome, and then rewriting the two tests to assert the new, deliberately-
chosen behaviour instead of the old one. Recorded as a deviation in the PR body rather than treated
as license to just make the old assertions pass again.

**Prevent by.** When a plan adds a new classification to an existing guard clause (here: "this order
now records `uncounted`" on a branch two *different* order shapes already reach), the plan should
name every existing test that exercises that branch and say explicitly what happens to it — not
leave "stays green, unedited" as the default assumption. A planner that lists a regression net
should generate it by running the touched module's arms against the increments, not by pattern-
matching on file/test names from the current shipped behaviour.

**Seen before.** None found (`grep -rl "regression net"` and `"unedited"` under
`docs/retrospectives/` turn up `ah-t2pn.3`, which is a different symptom — increments that cannot go
red in sequence — not a regression net contradicting its own design).
