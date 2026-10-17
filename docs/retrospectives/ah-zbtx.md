# ah-zbtx — seven test fixtures sailed fleets the rules refuse

**What happened.** Once a fleet that `fleet-overloaded` or `fleet-undercrewed` refuses was kept in
port on every surface, seven existing tests failed. None of them was about load or crew. Their
fixtures sailed fleets `rules/movement_sailing` says "will not go anywhere", and they asserted that
the fleet leaves:

- a lone sailing-2 captain on a Longship, which needs 4 levels (`data/LONG`), in four tests;
- Drones (1297), weight 970, boarding Raft [235], which carries 450;
- the raft's only crew giving away one of its two sailors;
- a 62-hull class fleet with 4 of its 762 sailing levels;
- 6220 aboard a Longship that carries 150. Here the "refused at the first step" tests were also
  passing on the overload, not on the geography they pin.

The warning fired on most of these fixtures all along, but the tests never looked at it.

**Why.** Before this bead, only the Problems panel knew a fleet could be refused for load or crew,
so a fixture's crew and cargo never had to be right for any departure test to pass. Fixtures were
written for the one fact under test, and the sailing check that would have flagged them was not
asserted against.

**Cost.** About half of the build phase. Each failure had to be read, the rule looked up, and a
fixture found that still tests what it meant to (a lighter boarder, another passenger forming the
unit, a level-4 sailor), because weakening the fix was not an option.

**Prevent by.** A shared fixture helper for "a fleet that sails" in `crates/core/tests/common/`. It
would build a hull with its crew at the hull's own sailing requirement and its load under capacity,
and assert that `review_turn` raises neither `fleet-overloaded` nor `fleet-undercrewed`. New sailing
tests would start from it instead of a hand-written Longship line.

**Seen before.** Nothing like it in `docs/retrospectives/`. ah-586v, the walking sibling, did not
hit this, since its fixtures already weighed their walkers.
