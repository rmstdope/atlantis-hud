# ah-mnvp — retrospective

- **Implementer:** Storm
- **Date:** 2026-10-17
- **PR:** #1658

## A pin on the share purse passed under the mutation the plan chose, because that mutation changed nothing

**What happened.** The plan pinned a leaver's STUDY and TRANSPORT draw on the hex it leaves. Its check that the pins bite was "make `claim_here` cap a leaver from STUDY on". Under that mutation the whole suite stayed green, except the new unit test of the record itself. A second guess, that a leaver claims nothing after movement (`position_here` → `max(0)`), also left both end-to-end pins green. Only re-applying ah-6cka's first fix exactly as it stood in 621224b2 failed all three: cap from STUDY on, measured against the Movement position.

**Why.** The month-end cap is `position.max(owed_at(Transport).min(0))`. Measured at TRANSPORT, it is a no-op at STUDY and TRANSPORT for any unit whose position at TRANSPORT already includes its study or shipment. So "cap from STUDY on" has to move the measuring moment too before it changes anything. Separately, a passenger's study loan and a walker's shipment are not decided through `position_here` at all, but through the study and shipping purses. The regression ah-6cka hit showed up as a not-enough-silver warning, so a pin has to assert on findings as well as on `borrowed_for_orders`.

**Cost.** Three extra runs of the core suite and about twenty minutes. A pin that could not fail nearly shipped, and the plan had to be amended.

**Prevent by.** In a share-purse bead's *The test plan*, take the mutation that proves a pin from the real regression's commit (here `git show 621224b2`), not a paraphrase of it. A pin on a purse loan asserts both the loan and the unit's not-enough-silver findings.

**Seen before.** ah-3ffm (a purse-lending test that checked totals could not see the order of lending): the same family, a purse test that cannot fail under the change it guards. ah-6cka: the same rule, which no core test pinned.
