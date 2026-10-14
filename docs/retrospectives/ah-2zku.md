# ah-2zku retrospective

## Two of the bead's core fixes merged first from other beads, across the producer and bugfix queues

**What happened.** This bead found that `charge_settled_upkeep` read a drained sharer's wage as still in hand, ignoring the SHARE purse's loans. Its first fix carried `purse_carried` there. After review it also handed a cut GIVE's unfunded part back to maintenance (`maintenance_silver`). While the PR was open, ah-rbei (#1576/#1571 family) merged the first fix in another form (`loans.silver_net_of_loans_at`), and ah-5xdk (#1579) merged the second (`UpkeepSilver`, "a giver whose cut gift comes back in part pays its own upkeep"). Step 4 was also restructured under the PR (ah-a6gv, `relief_mut`). The PR went `CONFLICTING`. Two of its four core commits resolved to main's code, and only the step-4 who-paid-whom bookkeeping and the hover were this bead's own.

**Why.** ah-2zku is a UX-agreed producer bead, filed from a verification follow-up. ah-rbei and ah-5xdk came through the bugfix queue from neighbouring verifications of the same SHARE/maintenance code. Nothing links a producer bead to bugfix beads that touch the same function, and the producer's plan named the root cause only once it was designed, after both had already been handed out.

**Cost.** About thirty minutes: four rebase conflicts in `semantics.rs`, re-checking both fixture cases on main's readings, and another gate and CI run. One review round (finding 1) went to a fix main delivered anyway.

**Prevent by.** As ah-9udi and ah-hreo propose for `scripts/bugfix-candidates`, and across both queues: once a producer's plan names a root-cause function (*Files to change*), check `bd list --status in_progress` for bugfix or producer beads naming the same function, and `git log origin/main -S<function>` since the bead was assigned, before building it.

**Seen before.** ah-9udi ("The same mechanism was built twice in parallel, again"), ah-hreo, ah-eoag.
