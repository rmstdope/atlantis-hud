
## A plan's *Out of scope* asserted an interaction as fact, and the fact was false

**What happened.** The plan's *Out of scope* section ruled out `PILLAGE` emptying the tax base with
a reason rather than a boundary: "a pillaged hex yields nothing to any taxer, so there is no pool to
oversubscribe and the two findings do not both fire." I read that as settled and wrote no test for
it. It is true of the *column* - `silver.rs`'s `Intent::Tax` arm short-circuits on `region.pillaged`
before it ever looks at the settlement - but not of the settlement itself, which read the region's
stated tax base and knew nothing about pillaging. Two taxers beside a pillager in a hex with a
stated base got both `taxed-a-pillaged-hex` and my new `region-pool-oversubscribed`, the second one
promising a division of a pool that no longer exists. Copilot's review carried no comments but named
"interaction with pillaged-hex taxing" as the thing warranting a human look; writing the test it
implied is what found this. The defect survived `ah-t2pn.2`'s refactor of the settlement into
`pool_shares_for`, so the same test caught the same bug twice, on two different shapes of the code.

**Why.** Established. An *Out of scope* entry that carries a justification reads as a check already
made, so nothing in the increments asked for a test of it - and the justification was about a
neighbouring code path (the column) rather than the one this bead added (the settlement).

**Cost.** About ten minutes the first time, five the second. No CI cycle: both were caught before a
CI wait, and the fix is one line and one test.

**Prevent by.** Where a plan's *Out of scope* claims two findings cannot both fire, `plan-bead`
should require that claim as a named test in the *Test plan* rather than a sentence in *Out of
scope*. It is an assertion about behaviour, and every other assertion about behaviour in a plan is
written as a test.

**Seen before.** `ah-ycuj` names the same pillage divergence as the reason its corpus-agreement
guard exists - a second surface pricing `TAX` differently in a pillaged hex - so this is that same
seam being crossed for the second time by a bead that did not expect to touch it.

## Two siblings merged during my CI wait, and the second one rewrote the code I had built on

**What happened.** `ah-t2pn.4` is the reporting bead of a four-bead family. When I claimed it, `.2`
and `.3` were `in_progress` with other implementers, so I followed the plan's instruction to
"implement only the pools that exist" and shipped the tax arm alone. `.3` merged while my first CI
run was green-but-unmerged, and `.2` merged during the second — each producing a `CONFLICTING DIRTY`
PR after checks had already passed. `.2`'s change was not a conflict I could resolve line by line:
it had generalised my `tax_shares_for` into a `pool_shares_for` over all three silver pools, with a
local struct of its own named `ContendedPool`, colliding with the public enum of that name my plan
specified. Resolving the rebase in favour of main and re-applying my change on top of it was the
only sane route, and once done, all four pools existed — so the plan's escape hatch no longer
applied and I implemented the wage, entertainment and market arms it specifies in full.

**Why.** Established. A family of four beads where three write the same function and the fourth
reports on it has no ordering that avoids this, and no edge was wired from `.4` to `.2` or `.3`
deliberately — the plan says so and gives the reason. What the plan did not anticipate is that the
siblings could land *between* a green CI run and the merge, which is where two rebases and about
forty minutes went.

**Cost.** Two CI cycles (about 25 minutes of waiting), two rebases, one of them a substantial
re-implementation, and roughly an hour and a half in total. Also two pushes past a review that
described a much smaller change.

**Prevent by.** Where a plan deliberately omits a dependency edge so a bead is buildable early, it
should also say what to do if the sibling lands mid-run — the choice between shipping the narrow
version and absorbing the sibling is a scope decision, and I had to make it twice with only an
"if it has not landed when you pick this up" to reason from. A line in `plan-bead`'s guidance on
unwired sibling edges would settle it once.

**Seen before.** None found.
