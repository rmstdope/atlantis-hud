# ah-42li — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-09-09
- **PR:** #1124

## I wrote two guard tests that never reached the guards, and said they covered them

**What happened.** The review's second finding asked for tests on two new guards in
`apply_transfers`' silver block — `moved > 0` and `source != transfer.actor`. I wrote two tests,
watched them pass, and posted that both guards were covered. The next delta round mutated both
guards to `if true` and ran the whole suite: 2510 passed, 0 failed. Neither fixture reached the
silver block at all — one gave the source no silver item, so nothing was walked for the tag; the
other produced no transfer, because `targets::give_endpoint` answers `GiveReach::Nowhere` for
`id == giver_id`. Both tests asserted on receipts that would be empty against an implementation
with the whole arm deleted.

Then I did it again, one round later and one guard over. Fixing the first case, I replaced the
`ALL SILV` fixture with a `100 SILV` one — which moved the coverage onto the *other* branch and
left the `ALL` branch's identical `moved > 0` with no test pointing at it at all. The round after
that mutated it to `if true` and the suite passed again.

**Why.** A passing test on a fresh assertion feels like evidence, and the arithmetic of these two
was right — `taken_away == 0`, no `WasTaken` entry — so nothing about reading them said the code
under test was never entered. Reachability is invisible from the assertions; only a mutation or a
probe shows it.

**Cost.** Two of this bead's four review rounds, roughly twenty minutes of round-trip, plus the
reviewer's time proving each one with an `eprintln!` probe.

**Prevent by.** `implement-bead`'s *Answering it, and going on* says every finding gets a change or
a reasoned reply. Where the finding is *"this is untested"*, the change is not a test that passes —
it is a test that **fails when the thing it names is broken**. Run the mutation before posting the
answer: break the guard, watch the named test fail, restore. It is three commands and it is the
same check the reviewer will run. And when a fix *moves* a fixture between branches, mutate both
branches, not the one being fixed.

**Seen before.** `ah-3mwm` — *"I twice claimed existing tests covered something without running the
mutation"*, same shape, same resolution, and its *Prevent by* says the same thing. That was for
claiming *existing* tests covered something; this is for claiming *new* ones did, which the earlier
wording does not obviously reach. Third sighting across the two.
