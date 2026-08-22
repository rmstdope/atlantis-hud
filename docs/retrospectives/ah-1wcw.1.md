# ah-1wcw.1 — retrospective

- **Implementer:** Storm
- **Date:** 2026-08-22
- **PR:** #562

## The plan asked for a smoke test its own measurement had already ruled out

**What happened.** The plan's increment 7 specified a smoke spec that loads the committed turn,
"find a unit with a `not-enough-silver` finding, click its Silver cell". No such unit exists: every
own unit of faction 95 in `neworigins-3.0.0-g7-f95-t71.rep` carries the `sharing` flag, and
`report_shortfalls` pools a sharing unit's silver and anchors the finding to the hex with
`unit_id: None`. So the spec's subject cannot be rendered at all. I found this by grepping the
fixture for `^\* .*Borg TNG (95)` after the spec's first draft could not locate a warned cell.

**Why.** The same plan states the measurement that makes it impossible — *"Measured on turn 71: 17
of 27 units are red, and **0 carry ⚠**"* — in *User-facing decisions*, and separately specifies the
test in *Increments*. The two sections were each right and were not read against each other.

**Cost.** About twenty minutes: one smoke run that failed for the wrong reason, then reading
`report_shortfalls` and the fixture to establish it was unreachable rather than mis-written.

**Prevent by.** In `plan-bead`, when a plan's *Increments* names a test against a committed
fixture, check it against any count the plan's own *User-facing decisions* measured on that same
fixture — a stated zero is a stated "this cannot be walked". The narrow, checkable form: a plan that
measures N of something on a fixture must not then ask for a test that needs N > 0.

**Seen before.** none found.
