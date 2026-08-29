# ah-qct4 — retrospective

- **Implementer:** Storm
- **Date:** 2026-08-29
- **PR:** #790

## Adding a `SILVER_NOTES` note turns two tests red, and the plan named one of them

**What happened.** The plan's *Known traps* warned that
`unitTooltip.test.ts`'s `it("has an expected sentence recorded for every note, and no more")` goes
red the moment a note is added, and said to add the `SAID_BEFORE` entry. I did. A second test in
the same file then failed:
`it("leaves no note unreachable but the two that read a silence")`, which walks an
everything-is-true `UnitSilver` built by a local `everything()` helper and asserts that exactly two
named notes stay unreachable. A new note whose fact is at the builder's default is a third, so the
guard fails with the new id in the diff.

**Why.** Established. `everything()` (`packages/shared/src/unitTooltip.test.ts`, near the bottom of
the file) is a hand-written `aUnitSilver({...})` literal, so a field added to `aUnitSilver` with a
neutral default is *not* automatically true there. Both guards protect a note against being added
half-way; the plan's traps list carried only the first, so the second arrived as a surprise at gate
time rather than as a step in the increment.

**Cost.** About four minutes and one extra local gate run. No CI cycle: `pnpm run check:fast`
caught it, and the failure message named the note id and the exact expected array.

**Prevent by.** A plan that adds a `SILVER_NOTES` entry should name **both** guards in its *Known
traps* and make the `everything()` fixture edit an explicit step of the increment — the entry in
`SAID_BEFORE`, the note's own `example()`, **and** the fact in `everything()`. The same sentence
belongs in `.cerebro/traps.md`, which today says nothing about `SILVER_NOTES` at all: it is a fact
about this package rather than about any one bead, and the next note-adding bead will hit it too.

**Seen before.** None found — `grep -rl "SILVER_NOTES" docs/retrospectives/` matches nothing else.
