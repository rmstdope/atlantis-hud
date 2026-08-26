# ah-dxfd.2 — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-08-26
- **PR:** (filled in when opened)

## Deriving a headcount from a unit's own items breaks any fixture that states `men` without a backing item

**What happened.** `LateHoldings::read` (semantics.rs) re-derives a unit's headcount from its late
item list via `report::composition::men_in`, exactly as the plan's *Files to change* section
specifies. Wiring `own_food_pass`/`pool_wants`/`price_study` onto that picture turned 56 previously
green tests red (`cargo test -p atlantis-hud-core --lib`) — every fixture built from the base
`unit()` helper, which sets `unit.men = 1` but pushes no man-tagged item at all. `men_in` correctly
reports 0 men for such a list, since a real report never states a headcount without a backing item,
but the fixture does exactly that.
**Why.** `men_in` trusts the item list completely, which is correct for a real report but not for
this test suite's dominant fixture shape.
**Cost.** One full local test run (56 failures), about 20 minutes to isolate the fixture gap from a
production bug, then a second full run to find the same cause hiding one more failure in
`carpenters()` (a second fixture with the identical gap).
**Prevent by.** `LateHoldings::read` now only re-derives a unit's `men`/`men_by_race` when the
*man-tagged* items in its late list actually differ from its early picture's — untouched units keep
the early (and so, transitively, the report's) headcount unconditionally, exactly as
`HoldingsAfterGifts::Unchanged` already does for the early picture. A future bead reading a fixture
unit's derived headcount should confirm the fixture backs `men` with a matching item (`men_holder`
in `semantics.rs`'s tests already does this; the bare `unit()` helper does not).
**Seen before.** None found.

## A unit's own `PRODUCE` reads a ledger balance its own ledger twin has already spent

**What happened.** The plan's picture table asks `PRODUCE`'s `price_production(recipe, men, items)`
call in `silver::forecast_unit` to read the late picture for both `men` and `items`. Wiring `items`
that way turned `a_producing_unit_spends_what_its_run_costs` red: a unit with silver for one
catapult and materials for two priced as `expense: Some(0)`, capped by an apparently-empty silver
balance, though the fixture holds 3000.
**Why.** `semantics::produce` (the ledger's own item-tracking pass, which runs for every hex before
`charge_upkeep`/`forecast_hex` ever read the balance) prices the *same* `PRODUCE` order a second
time from `actor.unit.men`/`actor.unit.items` and charges the plan's cost against
`ledger.balance` — unrelated to this bead, and unchanged by it. By the time `LateHoldings::read`
reads that balance back, the silver this same order needs has already been spent by its own ledger
twin, so `price_production`'s affordability check saw nothing left to spend.
**Cost.** About 15 minutes: one failing test, a debug-printed `UnitFacts::late()`, and a read of
`semantics::produce`'s own doc comment ("prices this same order a second time... from the ledger").
**Prevent by.** `PRODUCE`'s man-months capacity reads the late headcount (safe: a unit's own
production never changes its own headcount), but its materials/silver affordability check was left
on the early picture, with a comment recording why and that this is a deliberate, currently-narrower
reading than the plan's table describes. A future bead that wants `PRODUCE`'s materials to see a
`BUY` from earlier in the same block needs a balance snapshot taken *before* the ledger's own
`apply()` loop reaches that unit's own STUDY/PRODUCE/BUILD/ENTERTAIN/WORK orders, not the end-of-month
balance `LateHoldings` reads today - which is exactly the "never hand `combat_ready_in` a
`LateHoldings`" trap already named in this bead's own plan, recurring one level down.
**Seen before.** None found, but see *Known traps* in this bead's own plan for the same shape of
problem (`combat_ready_in` and a not-yet-filled balance) one phase boundary earlier.

## A `GIVE` to a target this application cannot resolve already empties the giver, in the ledger, whether or not the plan says so

**What happened.** Four existing tests asserting a `GIVE` to a foreign unit, a unit formed this
month, another faction's new unit, or a unit the report shows elsewhere produces no findings turned
red once maintenance started reading the ledger's balance: each fixture gave away its only food,
and the giver came back short of its own upkeep in silver.
**Why.** `semantics::transfer`'s own doc comment already says so - "a gift out of the hex is charged
to the giver and credited to nobody" - and that is pre-existing, correct, untouched-by-this-bead
behaviour: the goods really do leave. This bead's plan explicitly keeps the *early* (skills/men)
projection treating such a gift as a no-op (`resolve_give_target` answering `Nowhere`, "Out of
scope: a gift to a foreign unit... the giver keeps what it gave"), which is a different picture from
the ledger's own item/silver balance and was never in tension with it until maintenance started
reading that balance too.
**Cost.** About 15 minutes to trace one failing assertion back to `transfer`'s doc comment, once for
the first of the four; the other three followed the same fix immediately.
**Prevent by.** The four fixtures now use the existing `unfed` helper so the giver's maintenance is
paid in silver rather than the food it is about to give away, decoupling the assertion under test
(no location finding) from the unrelated (and correct) maintenance effect. A future bead reading
`ledger.balance` for a *new* purpose should expect a unit's `GIVE`/`TAKE` orders to have already run
against it in full, including to targets this application cannot resolve.
**Seen before.** None found.
