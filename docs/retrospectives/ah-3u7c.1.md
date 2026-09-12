# ah-3u7c.1 — retrospective

- **Implementer:** Wolverine
- **Date:** 2026-09-12
- **PR:** #1198

## The plan's own RED test passed against the unchanged code

**What happened.** Increment 3's named failing test was specified down to its fixture: preview
`unit 666\nMOVE 1 IN\n` over `atlantis_hud_fixtures::G4_F17_T0` and assert `Departing` with
`departing_to: None`. Written exactly as specified and run before the production change
(`cargo test -p atlantis-hud-core --test orders_preview`), it **passed**. With the passage at step
zero the traced route has no steps, so `months` comes out empty, and `effects.rs`'s existing
`None => status = UnitPreviewStatus::Departing` arm already produced the asserted answer. The
increment's actual change — clearing `arrival` when `path.passage.is_some()` — was unexercised.
A second test, `a_passage_after_a_step_still_departs_to_nowhere_nameable`, where the unit walks a
hex and *then* enters the passage, is genuinely red (`left: Some("1:2,2")`, `right: None`); it is
what pins the change and it merged alongside the planned one.

**Why.** The plan picked the fixture for how vividly it shows the case to a human — a nexus with
seven gateways — rather than for whether it discriminates. A passage ordered at step zero is the
one shape where the new arm and the pre-existing empty-months arm agree, so the most obvious
fixture is the one that cannot tell them apart.

**Cost.** About ten minutes: writing the test, seeing it pass, working out why, and building a
second fixture that discriminates.

**Prevent by.** `plan-bead`'s increment sections already name each increment's failing test; they
should also name *what makes it fail* — which existing branch the assertion would otherwise be
satisfied by. Where a plan writes a test's fixture out in full, that sentence is what forces the
check that the fixture reaches the new code rather than an old path with the same answer.

**Seen before.** `ah-26jt` — same finding, different mechanism: a plan wrote its RED test's data out
in full and the expectation held by coincidence against the unchanged code. This is its second
sighting.

## The plan placed a map mark where it could never render

**What happened.** The plan specified the passage ring as drawn "immediately after the dotted route
polyline (`MapCanvas.tsx:1306`) so it sits on top of the line". Written there, it rendered nothing
at all: that group is gated on `{(routeLine.solid || routeLine.dotted) && ...}`, and this bead's
whole point is a route with no drawn line, so both strings are empty in exactly the case the mark
exists for. The same group is `pointerEvents="none"`, under which the plan's own `<title>` hover
could not have shown either — which the plan knew, since its *Known traps* section says so about
theme `MarkLayer`s. The mark is now its own `<g>`, a sibling of the route group.

**Why.** Not established beyond the obvious: the placement was chosen for paint order (after the
line, so it caps it), and the two conditions that make the position unusable are on the enclosing
element rather than the neighbour the plan pointed at.

**Cost.** About ten minutes — one vitest run showing a fully-rendered map with no ring in it, and
reading outward from the insertion point to find the gate.

**Prevent by.** A plan that names an insertion point by line number should name the enclosing
element's own condition and pointer-events, not just the neighbour to sit after — for this file
especially, where the route group is conditional and much of the map is `pointerEvents="none"`.
`ah-brgo.1` records a sibling of this for `<use>` and pointer-events inheritance in the same file.

**Seen before.** `ah-brgo.1` — different symptom, same file and the same class of surprise: where a
`pointer-events` value on an enclosing or referenced element defeats what the new element asks for.
