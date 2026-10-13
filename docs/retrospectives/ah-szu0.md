# ah-szu0 — retrospective

- **Implementer:** Nightcrawler
- **Date:** 2026-10-13
- **PR:** #1544

## Three review rounds in a row found the purse and the cast pricing disagreeing about a cast

**What happened.** Each fix to the SHARE purse's CAST moment (`Lending::settle`) was green locally
and in the new tests. Then the next cold review built a probe that the ledger's own `cast()`
pricing, or `SharerStock::at`'s reading, judged differently. The cases were: a refused cast still
spending the caster's own silver; a paid cast's unfunded part counted twice; and the fold refusing
a different caster than `cast()` did. That last one happened when a sharer cast after a borrower.

**Why.** Who-pays-for-which-cast was answered in three places from three different figures. `cast()`
prices each spell in report order against `SharerStock::at` at the Cast phase, and books what nobody
funded in `Ledger::unfunded`. The fold judged the Cast moment again, on the balances after every
cast was charged. `SharerStock::at` added `unfunded` back on top of whatever the fold lent. The final
fix made the fold take `cast()`'s verdict (`Ledger::unfunded_casts`), so the verdict is reached
once.

**Cost.** Three follow-up review rounds and three fix pushes, about an hour and a half, plus a
rebase conflict with ah-3uuf, which changed the same fold the same afternoon.

**Prevent by.** A doc paragraph on `Lending` (semantics.rs) naming `cast()`'s per-caster verdict
(`Ledger::unfunded_casts`) as the one answer to "was this cast paid", with a test per spender kind
(study, cast, BUY) in which a later spender in region order is refused after an earlier one
borrows.

**Seen before.** ah-0mch (a sharer's stock lent twice through `unfunded`).
