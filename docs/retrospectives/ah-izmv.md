# ah-izmv

## The "assert the findings too" half of a purse pin could not fail on the fixture the bead named

**What happened.** The acceptance asked for one core test that drains a sharer with a GIVE, has the purse pay its STUDY, and asserts the column, the loan and the not-enough-silver findings together, "so a change to either reader alone turns it red". The column and loan values went red under both mutations the plan chose. The findings check stayed at "none" under those two and under two more tried after the review flagged it: the purse skipping the Give phase, and `GiveDraws::lent_by` reading 0. A dump of every finding in the hex showed no silver finding at all in any of the four.

**Why.** The SILVER column and the purse move the unit's own `short_for_orders`. The not-enough-silver warning judges the hex's pool as a whole, and in G7 F95 T71's ocean (26,52) the pool holds the 20000 the GIVE moves. So no change to either reader can raise a finding on 13403 there. ah-mnvp's *Prevent by* ("a pin on a purse loan asserts both the loan and the unit's not-enough-silver findings") carried into this bead's acceptance as a requirement, without a check that the fixture can reach a finding.

**Cost.** One review round: the reviewer's top finding, four mutation runs of the integration test (about ten minutes), and a test doc that has to explain an assertion that cannot catch anything.

**Prevent by.** In `produce-bead`'s *The test plan* for a share-purse bead: before a pin asserts findings, run one mutation that should raise the finding and see that it does. If none can on the chosen fixture, say in the test that the findings half guards against a false warning only, and do not count it as the half that bites.

**Seen before.** ah-mnvp, the source of the rule this bead followed. ah-3ffm, a purse test that could not fail under the change it guarded. Same family.
