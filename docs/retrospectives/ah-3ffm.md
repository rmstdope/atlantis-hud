# ah-3ffm — retrospective

- **Implementer:** Storm
- **Date:** 2026-10-16
- **PR:** #1645

## A purse-lending test that checks totals cannot see the order of lending

**What happened.** The plan's seam test asserted how much the sharers had lent in total at each shipment. Even so, a mutation that lent every draw at the start of TRANSPORT's run still passed the whole suite. The plan's second test (a fee drained on what an earlier draw left) had the same blind spot when worked by hand. The test had to be rebuilt around two sharers, with assertions on which sharer lent what at an intermediate shipment. Only then did the order mutation fail it.

**Why.** The purse lends to cover every overdraft at each reading. So wherever every claim fits, the amount lent at any point equals the overdrafts so far, whatever order the steps run in. The order only shows in *which* lender paid: two lenders in drain order, read between two steps. Otherwise it shows only in a pool too short to pay.

**Cost.** Three mutation runs of the core suite and a rewritten test, about fifteen minutes.

**Prevent by.** Extend the `Lending::settle` doc comment's observability note, written in this bead, with the second half: a test of lending order must read *who* lent at a point between two steps, with at least two lenders. Totals alone can never fail under an order mutation. A plan that tests lending order names its two lenders from the start.

**Seen before.** `ah-9yvv`: a TRANSPORT lending error hidden by the month-end re-lending. Same family (a purse figure that repairs itself), but a different mechanism.
