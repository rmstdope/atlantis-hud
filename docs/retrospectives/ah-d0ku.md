# ah-d0ku — retrospective

- **Implementer:** Rogue
- **Date:** 2026-09-03
- **PR:** #901

## The plan promised the existing transport tests as an unchanged regression suite, and one of them encoded the behaviour being replaced

**What happened.** The plan's *Test plan* states "Existing tests under `orders::effects::tests::transport`
remain the regression suite" and lists no exception. After the phase pass was in,
`a_unit_whose_transports_net_to_nothing_is_still_sent` failed: it has unit 5530 send stone to 6857
and 6857 forward the same stone on, and with neither unit holding the quartermaster skill both lines
fall in phase 1, where `rules/sequenceofevents`' "only once in each phase" correctly stops the
forward. The test was written against the old single document-order pass. Fixing it meant giving
6857 the `quartermaster [QUAM]` skill its name already claimed, which is a fixture edit — and the
first review round then correctly flagged that the edit had removed the only coverage of the phase-1
case, which had to be added back as a new test.

**Why.** A plan that changes when an existing behaviour happens cannot assume the tests pinning that
behaviour are neutral; some of them are the old behaviour written down.

**Cost.** About 20 minutes: one failing gate leg, one fixture decision, and one blocking review
finding with the test it asked for.

**Prevent by.** In `plan-bead`'s test-plan section, a plan that reorders or re-phases an existing
pass should name the existing tests it expects to change and say what they should assert afterwards,
rather than declaring the whole existing module unchanged.

**Seen before.** None found — `grep -rl "regression suite" docs/retrospectives/` matches nothing
about a plan mis-promising an unchanged suite.
