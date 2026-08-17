# ah-ssd — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-08-18
- **PR:** #419

## The plan specified a rule the codebase had already settled differently

**What happened.** The plan's *Known traps* said "Last one wins, by insertion. Do not sort and do
not `.rev().find(...)`" for a unit's ENTER and LEAVE lines, and gave the exact `insert`-per-line
code to write. That is not the rule: ah-mjy (#418, merged the same day the plan was written)
established with the navigator that **every LEAVE runs before any ENTER**, so a block holding an
ENTER ends inside it whichever way round the lines were typed, and
`orders::semantics::structure_after_orders` implements exactly that. Following the plan literally
would have shipped a brand-new disagreement between the two layers — which is the one thing this
bead's acceptance criterion forbids. I found it only in REFACTOR, while reading
`structure_after_orders` to write the cross-reference the plan asked for; the implementation and
one test had to be rewritten at that point.

The same reading turned up a third model: `Working::visit` in `orders/effects.rs` applied the two
orders in plain document order, so `ENTER 4` then `LEAVE` left the unit ashore there while both
other readers put it inside. Fixing it was in scope only because the bead is about the models not
disagreeing; the plan did not mention it and listed `effects.rs` as a one-word call-site change.

**Why.** The plan was written against `origin/main` at `43d1b73`; ah-mjy's follow-up fix (#418,
"every LEAVE runs before any ENTER, so a block with both ends inside") landed after that and is the
tip this bead branched from. The plan quotes `orders/effects.rs:570-575` as "the authoritative
version" of the rule, and that file was the one reader ah-mjy did *not* correct — so the plan
copied the rule from the only place still stating it wrongly.

**Cost.** About 25 minutes: rewriting one increment's implementation and two tests in REFACTOR
rather than writing them right in RED, plus the `Working` fix and its corrected test. No CI cycles;
it was caught before the PR opened.

**Prevent by.** When a plan names a blocking bead as merged and quotes a rule that bead was about,
read that bead's *own* merged code before writing the first test — `git log origin/main --grep
"(<blocker>):"` and open the function it changed, rather than the file the plan cites. Concretely:
the plan's *Context* section named ah-mjy and `structure_after_orders`, and reading that function
first would have cost two minutes and made the RED tests correct.

**Seen before.** none found.

## The adversarial review found a regression the whole suite was green on

**What happened.** The plan said to change both `structure_id` comparisons in `steps_followed_by`
(`:89` and `:105`) to the new after-orders reader. Doing so was a behaviour regression on the second
one: that comparison finds **who wrote the hull's movement order**, and a unit that writes `SAIL SE`
and then `LEAVE` still gave that order — the server reads the SAIL line before running the LEAVE,
which `orders::semantics::could_captain` says in as many words. After the change, every passenger of
such a hull was traced as staying put. All 803 core tests were green on it; the general-purpose
review agent spawned in REFACTOR found it by reading `could_captain` and comparing.

**Why.** The two comparisons look identical and answer different questions. The plan treated them as
one edit, and no fixture exercised a captain that also leaves.

**Cost.** None beyond the review itself — it was found and fixed before the PR opened. Had it
shipped, it would have been a silent wrong answer in the tracer and the preview.

**Prevent by.** Nothing to change in the instructions: the REFACTOR-phase independent review is
already mandatory and is what caught it. Recorded because it is evidence that the review earns its
place on a diff whose own suite is entirely green — worth remembering the next time skipping it
looks safe.

**Seen before.** none found.
