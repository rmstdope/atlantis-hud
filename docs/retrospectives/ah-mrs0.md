# ah-mrs0 — retrospective

## The reported symptom was the test helper counting a GIVE as a shipment

**What happened.** The bead said unit 901 was shown shipping 100 silver it never had (TRANSPORT ALL SILV). Reproduced with `silver_shipped(&review, "901")`, it did read 100. But on main, 901's TRANSPORT line already shipped 0. `silver_shipped` (semantics.rs tests) sums every `GaveAway` change on the unit, so it counted the GIVE 900 100 SILV line as a shipment. The real wrong figure in the reported case was the sharer's: 902 shipped 150 instead of 50.

**Why.** `silver_shipped` was written for tests in which the unit's only `GaveAway` is its TRANSPORT. A test that also orders a GIVE of silver gets the sum of both, and its name says nothing about that. The reviewer who filed the bead (ah-szu0's third follow-up review) read the figure the same way.

**Cost.** About twenty minutes: a "fix" that turned the first test green, then the discovery that the test was also green on main, then re-deriving which unit's figure was really wrong.

**Prevent by.** Making `silver_shipped` (crates/core/src/orders/semantics.rs, test module) sum only `GaveAway` changes whose `line` is a TRANSPORT line, or renaming it to say it counts gifts too. Separately, a bug-fix step that runs the reproduction test against `origin/main` before the fix, and not only after it, so a test that passes on main is caught as a wrong test at once.

**Seen before.** No.
