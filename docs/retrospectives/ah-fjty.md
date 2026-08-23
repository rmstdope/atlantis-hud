# ah-fjty — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-08-23
- **PR:** #599

## The plan specified a per-unit reading of a hex that the check it must agree with reads as a pool

**What happened.** The plan gave `upkeep_claims` in full, down to its doc comment: a unit claims
from the faction's unclaimed fund what its *own* silver balance cannot cover. Implemented exactly
as written and with every one of the plan's fourteen tests green, it invented claimants. Where a
hex holds a `sharing` unit, `report_shortfalls` judges the whole hex as one purse and says nothing
about a penniless unit standing beside a rich one — so a unit whose maintenance its faction-mates'
silver already pays became a claimant on the fund. On the committed turn that was **$870 of
phantom claims against $50 of real one**, and because a fund that cannot reach every claimant
rescues nobody, those phantoms could deny a genuine claimant the rescue the bead exists to give.

**Why.** Established. The plan reconciled the fund against every earlier step of the payment order
it names — own food, faction food, late income — and against `CLAIM`, but not against the hex's
shared silver, which is not a step of the payment order at all: it is how `report_shortfalls`
reads a hex. Nothing in the plan's *Known traps* or *Out of scope* mentions sharing, and the two
sibling beads it warns about (`ah-e66j`, `ah-eacd`) are both payment-order steps, which is where
the attention went.

**Cost.** About 25 minutes, all of it inside the run: the adversarial REFACTOR review found it
before the PR opened, so it cost no CI cycle and no review round. Had it merged, it would have
shipped a wrong number to a real turn with every test green.

**Prevent by.** When a plan adds a term to a figure an existing check reads, the plan's *Files to
change* should name **every rule that check applies to that figure**, not only the rules of the
domain the new term comes from. Concretely for this module: `report_shortfalls` applies two
readings of a hex — per unit, and pooled where anything shares — and any bead touching a silver
balance owes an answer for both. A cheaper mechanical version: `grep -n "shares()" semantics.rs`
before writing a claim over unit balances.

**Seen before.** `ah-1wcw.1` — same rule, opposite direction: its plan specified a smoke test
against a unit with a `not-enough-silver` finding, and the committed turn has none, because every
own unit shares and the finding is anchored to the hex. That is twice now that a plan for this
module has been written as though a hex were judged unit by unit.

## The two red CI jobs were the bead working, in a suite the fast gate does not run

**What happened.** `pnpm run check:fast` was green and CI's `smoke (web, 2, 2)` and
`smoke (desktop-shell, 2, 2)` failed, both on `toContainText("upkeep")` against the region
problems panel. Neither was a defect: the word came from the hex message's "their orders **and
upkeep** spend", and this bead pays that hex's one fee out of the unclaimed fund, so the sentence
correctly drops to "their orders spend".

**Why.** Established. The plan's *Validation* named `check:fast`, `check:generated` and the two
test suites, and predicted the corpus test in `crates/core` would move — which it did, and was
handled. It did not predict that the same real turn is also asserted on by the browser suite,
which the fast gate does not run and which is therefore the first sight of that class of change.

**Cost.** One CI cycle, about 12 minutes, plus a local smoke run to reproduce.

**Prevent by.** A plan whose *Known traps* predicts the `crates/core` corpus test will move should
predict the browser suite too, in the same sentence: both assert on the same committed turn, and
`grep -rn "upkeep\|not-enough-silver" tests/` is one command that finds the second before the PR
opens rather than after. Worth adding to the plan template's trap list as "the committed turn is
asserted on from two suites".

**Seen before.** None found.
