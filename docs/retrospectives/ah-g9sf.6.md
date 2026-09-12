# ah-g9sf.6 — retrospective

- **Implementer:** Storm
- **Date:** 2026-09-12
- **PR:** #1188

## A plan that rewrites a user-visible string still has to name the smoke specs asserting it — third sighting

**What happened.** The plan's *Test plan* said "**Browser suites: not extended**", reasoning that
there is no smoke coverage of the movement planner today and that every changed string in `shared`
is a pure function with a unit test on it. That reasoning is about where a *new* test would go.
`tests/smoke/workspace.spec.ts:2294` ("an illegal move is refused with the reason") already asserted
the old refusal for a clicked ocean hex, and the bead's whole point is that such a hex now draws a
different, agreed sentence. Two shards went red in CI:
`expect(page.getByTestId("planner-problem")).toContainText("sea")` against
`"(8,52) is ocean, and this unit would need a ship to be there."`

The plan named nine user-visible strings verbatim and said which of them were changing. One grep for
any of them would have found it:
`grep -rn "planner-problem" tests/smoke/`, or the string itself.

**Why.** Established: the same cause as both earlier sightings. A plan reads the smoke suite as a
place tests are *written* rather than as a reader of the strings the bead rewrites. In this bead the
assertion did not even quote the changed sentence — it matched the single word "sea" — so grepping
for the *new* wording would have found nothing; what finds it is grepping for the panel's test id,
or for the words of the string being replaced.

**Cost.** One CI cycle, about fourteen minutes: two smoke shards ran eight minutes to fail, and the
whole suite ran again after the one-line fix. One of the three CI fix attempts.

**Prevent by.** `design-the-build` requiring that a plan changing a user-visible string grep
`tests/smoke/` for **the string being replaced and for the test id of the element that carries it**,
and list what it found — not only for the new wording, and not satisfied by "there is no browser
coverage of this feature". `ah-l09a.1`'s prevention names the string; this sighting is the case where
that alone is not enough, because the existing assertion matched one word of it.

**Seen before.** `ah-rgkk.3.3` — same cause, found in CI. `ah-l09a.1` — same cause, caught in review
before CI. This is the third sighting, and the second to reach CI.
