# ah-sdjy — retrospective

- **Implementer:** Storm
- **Date:** 2026-09-08
- **PR:** #1067

## The plan pinned existing tests as the proof, and their fixtures did not carry the field the new reader needs

**What happened.** The bead is a behaviour-preserving refactoring, and the plan's increments 2 and 3
name the existing suites as their guard: "its guard is the eight existing cases in
`studyStanding.test.ts:71-199`, unmodified", and acceptance criterion 4 asks that the file differ
from `origin/main` "by exactly the one added case". The new reader (`previewPairs`) pairs a mover's
`departing` row with its `arriving` one on `departingTo`/`arrivingFrom`, as the plan specifies.

`studyStanding.test.ts`'s `row()` helper builds a preview row out of `{ regionId, unitId,
structureId, status }` and **sets neither of those two fields** — the old reader keyed on the unit
number and the status alone, so it never needed them. Two of the eight cases build a departing row
and an arriving row for one mage, and both went red the moment the substitution landed, in a way
that reads exactly like the new reader being wrong.

It was not wrong: `crates/core/src/orders/effects.rs:846` sets `arriving_from` on every arrival and
`:881` sets `departing_to` on every departure, so the fixtures were not valid preview responses.
The fix was to extend the helper (and four call sites) to carry them — no assertion changed — and to
record the divergence from criterion 4 in the PR body, where the review then confirmed it as the
plan being wrong rather than the code.

**Why.** The plan checked the *reader's* inputs carefully — its *Known traps* has a whole entry on
`studyStanding.test.ts` building rows with no `unit.regionId`, and directs the new module to take the
hex from the enclosing `RegionPreview` because of it. It did the same analysis one field short: the
same fixtures are also missing the two fields the pairing itself is keyed on. So the trap that was
found and the trap that was missed are the same trap, in the same helper, in the same file.

**Cost.** About fifteen minutes: one red run, reading `effects.rs:810-905` to establish which fields
the core actually sets, the fixture change, and a paragraph of the PR body. No CI cycle — it was
caught by the local gate.

**Prevent by.** When a plan makes an existing suite the guard for a substitution, and the new code
reads a field the old code did not, the plan's *Known traps* should say whether that field is present
in the existing fixtures — the check is `grep` for the field name in the test file, and it is the same
check the plan already ran for `unit.regionId`. Where it is absent, the plan should say so and grant
the fixture change explicitly, rather than an acceptance criterion forbidding it and the implementer
having to overrule the criterion.

**Seen before.** `docs/retrospectives/ah-titf.md` §"The plan derived a rule from real reports, and the
test fixtures do not have their shape" — same shape: a rule correct against real data, existing
fixtures that do not have the shape real data has, and existing tests going red for that reason
rather than for a defect.
