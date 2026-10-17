# ah-p5ow — retrospective

- **Implementer:** Nightcrawler
- **Date:** 2026-10-17
- **PR:** #1699

## A warning-only bug grew into re-modelling exchange settlement, and took five review rounds

**What happened.** The bug was that an EXCHANGE the game will abort raised no warning. The first
fix recorded every aborted pair in `settle_exchanges`, including pairs aborted because a side was
short. The first review showed that a short side paid by *another* exchange pair gets a false
certain warning. The ledger settles pairs in the order lines are written, while the engine's
`DoExchangeOrders` walks units in report order. I tried to fix that inside the bug three times:
suppressing, then treating as uncertain, then reading every holding before settling. Each review
found a new case (through SHARE lenders, foreign partners, or the opposite direction), and each
attempt changed both settlements and the doubt bookkeeping. On the fourth pass I reverted the
settlement to main's and warned only aborts that cannot depend on order. The settlement gap went
to ah-6cni.

**Why.** The warning was built on top of a settlement that was wrong for chains before this bead
started; the first review said so. Each fix treated the reviewer's specific case instead of
asking whether the warning needed the settlement to be right at all. It did not. "Warn only when
the result does not depend on what the ledger gets wrong" was available from round one.

**Cost.** Four review sub-agent rounds beyond the first, about two hours of wall-clock and four
extra fast-gate runs. The final diff is smaller than the round-two one.

**Prevent by.** In `skills/fix-bug/SKILL.md` *The bug-fix contract*, step 4 ("smallest coherent
change"), add: when a review finding shows the fix leaning on behaviour that was already wrong
on main, first ask whether the fix can be made independent of that behaviour (warn less, never
falsely), and file the underlying gap as its own bead, before changing the underlying behaviour
inside the bug.

**Seen before.** None found. `grep -rl "widen\|narrow" docs/retrospectives/` turns up scope
changes to checks (ah-6cka) and CI (ah-wwyr), not a bugfix that absorbed a pre-existing gap.
