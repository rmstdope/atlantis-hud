# ah-8myf — retrospective

- **Implementer:** Wolverine
- **Date:** 2026-08-25
- **PR:** #684

## A plan that specified two message wordings did not say which condition picks between them

**What happened.** The plan gave both sentences verbatim — the `here` one for a unit staying put
and the `there` one for a unit sailing — and separately, under *User-facing decisions*, recorded
that "a sail with no `Go` steps is treated as staying put". It never joined the two, so nothing in
it said which of the two sentences a bare `SAIL` gets. I wrote the selector as "is there a `SAIL`
at all", which reads naturally from the two-row table, and every test in the plan's own test plan
passed. Copilot's review caught it: a passenger aboard a fleet whose captain ordered a bare `SAIL`
was told `cannot produce fish there: the region this vessel is sailing to produces …` about the hex
it was standing in. I confirmed it was real by flipping the condition back and watching the new
test fail.

**Why.** The plan specified the *messages* as a table of cases and the *behaviour* as prose in a
different section, and the case that falls between them — a sail that is a sail but goes nowhere —
appears in the behaviour prose and in `sail_destination`'s own doc comment but in neither row of the
message table. The plan's test plan has no test for a bare `SAIL`'s wording either, so the gap was
invisible from inside the increments.

**Cost.** One review round and one full CI cycle, about twenty minutes. No rebase, no hand-back.

**Prevent by.** When a plan specifies more than one wording for one code, its message table should
carry the **selector** as a column — the condition that picks the row — not only the case name and
the sentence, and the test plan should name one test per row asserting that row's sentence
verbatim. Here the selector is "the destination differs from the current hex", which is a different
question from "the unit is aboard a sailing vessel", and writing it down would have made the bare
`SAIL` row obviously missing. This is `plan-bead`'s *User-facing decisions* section.

**Seen before.** None found — `grep -rl` over `docs/retrospectives/` for the wording and message
terms turned up nothing describing this.
