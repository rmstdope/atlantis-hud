# ah-fdmb — retrospective

## A defect in the merged gap finder showed up only when every fixture was checked against its own ruleset

**What happened.** During design, a throwaway wasm test parsed every fixture report and ran ah-gicw's `rulesetGaps` against each report's own ruleset. The standard smoke turn (g7 f95 t71) reported an undefined building called `8 Corsairs`. A fleet of one kind of ship prints as `ADF Implacable [868] : 8 Corsairs.`, so its `baseKind` carries the count. ah-gicw had merged with this, because its tests build reports with `aStructure` and never met the real spelling.

**Why.** `rulesetGaps.test.ts` builds its reports from TypeScript builders, since a TS unit test cannot parse a `.rep` without the core. Nothing ran the rule over the committed reports through the real parser.

**Cost.** None to the build, because the probe found it first. Had it not, the new dialog would have opened in nearly every smoke walk, since `loadReport`'s default turn is t71, and for every player with such a fleet.

**Prevent by.** A `packages/browser-core` wasm test that checks every fixture report against its own ruleset and expects nothing missing. That is the validation of ah-n30q, which also covers the real data gaps the probe found (`nexus`, `barren`, `dungeon`, `blasphemous ritual`).

**Seen before.** No.

## A smoke walk green locally was red in CI because its wait proved nothing

**What happened.** "a batch with nothing new to check waits behind an open check for its Import summary" passed locally and failed on both CI projects. It waited with `expect(import-status).not.toContainText("Importing")`, which passes at once whether or not the second batch has finished. In CI the second batch finished after the check closed, and its Import summary replaced the first while the first was on screen. That was a real defect, now fixed: a summary queues behind one already showing.

**Why.** A negative assertion used as a wait succeeds immediately, so the walk's order depended on machine speed.

**Cost.** One CI cycle (about 15 minutes) and one fix attempt.

**Prevent by.** In `tests/smoke/gameSetup.ts`, a note beside the import helpers: never wait on `not.toContainText` of a transient status. Wait for a positive end state, or write the walk so the outcome does not depend on order.

**Seen before.** Not for this symptom.
