# ah-o9t1 — the core said the hover would speak; the Silver hover did not

**What happened.** PR #1843 made the core record a refused TRANSPORT/DISTRIBUTE of ALL SILV after a
GIVE emptied the stock, and proved "the hover and Problems say the same thing" with
`effects::transport_issue_sentences` and the `the_hover_and_the_problem_say_the_same_thing`
integration tests. It merged green. Verification failed: the Items hover spoke, the SILVER hover
did not, because `refusedSilverShipments` (`packages/shared/src/unitCellPopup.ts`) keeps only
issues with `amount > 0`, and this refusal is recorded with amount 0.

**Why.** "The hover" is two hovers. The core's issue list feeds the Items hover unfiltered, but the
Silver hover selects from it again in TypeScript. The plan placed all work and tests in the Rust
core and said so ("all work and tests are in the Rust core"), so no test sat on the layer that
actually decides what the Silver hover prints.

**Cost.** One failed verification, a P0 reopen, a second producer pass and PR (#1846), and the
navigator's time on a second look.

**Prevent by.** In a plan whose acceptance names a hover, the test plan names the TS function that
builds that hover (`columnPopup`/`popupForCell` in `unitCellPopup.ts`) and pins the agreed string
there, not only at the core's sentence list; `produce-bead` *The plan*, "The test plan".

**Seen before.** Not in `docs/retrospectives/`.
