# ah-d8qy — retrospective

## Nine fixtures made the passenger the hull's owner without saying so

**What happened.** The fix moved "who sails" from "the first unit aboard that could captain and wrote
a SAIL" to "the fleet's owner after PROMOTE". Nine existing tests went red at once:
`passenger_palace`, `sailing_north`, two `shared_region_products` hexes and two production
fixtures. Each listed the passenger, or a shipmate, before the sailor under the hull. By
`rules/world_structures` ("the first unit listed under the object") that unit is the owner. So
under the real rule the fleets in those tests never sailed, and the tests were green only because
the old reader ignored ownership. Two of them (`a_passenger_without_the_skill_is_still_told` and
its neighbour) would have stayed green after the fix for the wrong reason: the hull stayed in
port, not the case the test names.

**Why.** Test helpers push units in whatever order reads naturally, and before this bead nothing
on the passenger paths read ownership. The cold-read review then found the same blind spot in the
fix itself: a promoted FORM unit that gains nobody is deleted before movement, which hands the
hull back.

**Cost.** One unplanned fixture sweep (nine tests) and one review round. About twenty-five minutes.

**Prevent by.** A fixture helper in `crates/core/src/orders/semantics.rs` that puts units aboard a
hull lists the unit meant to sail it first. `passenger_palace` now does this, with a comment citing
`rules/world_structures`. Any new aboard-a-fleet fixture should either reuse it or follow the same
order.

**Seen before.** ah-lnz4: report order was never varied, under a different symptom (SHARE lenders).
