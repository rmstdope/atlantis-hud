# ah-rbei — retrospective

## A fourth maintenance reader of a lender's silver sat outside `Lending`, found only by the audit

**What happened.** The bead was filed as a behaviour-preserving refactor: put maintenance into `share_pool_agreement` and route steps 4-7 through `Lending`. The plan's audit step at first recorded verdicts only for the readers already pre-read. The cold-read review asked for every remaining reader to get a verdict. That turned up maintenance step 3's wage cover (`charge_settled_upkeep`'s `in_hand`), which read `spendable_silver_at(Transport)` raw. A sharer that lent its silver to a BUY, then worked and shipped its wages, had its fee read as paid. It got no faction-mate relief and no warning, and the month ended at -10. The fix and a fourth agreement case went into the same PR (d4935c46).

**Why.** Maintenance reads a unit's silver in more than one step. The ah-su1x and ah-6y6e fixes, and the bead itself, named step 4 (`purse_carried`'s callers) as "maintenance's reader". Step 3 reads silver too, through a different helper whose name does not say "balance".

**Cost.** One extra review round, a behaviour fix inside a refactoring PR, and an amended plan, whose *Decided by me* and *Validation* had to be rewritten after the follow-up review.

**Prevent by.** List the maintenance readers by searching for every read of silver at or after `StatePhase::Transport` (`spendable_silver_at`, `balance_at(.., Transport | Maintenance ..)`, `silver_balance`, `relieved_balance`), not by the name of the last function fixed. Put that search in the *Validation* of any bead that claims "maintenance reads X".

**Seen before.** docs/retrospectives/ah-su1x.md §Seen before: a second reader of a lender's balance that the purse's lending had not reduced (TRANSPORT, then maintenance step 4). This is the third such reader, maintenance step 3.
