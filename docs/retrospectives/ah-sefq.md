# ah-sefq — retrospective

- **Implementer:** Storm
- **Date:** 2026-09-09
- **PR:** #1106

## The plan's own guard assertion could not fail

**What happened.** The plan's increment 5 named one assertion as the thing that catches a forgotten
`by_coordinate` gate: "the same all-land single-step case as increment 3, run through `check_turn`
with `disabling(codes::PRODUCE_NOT_HERE)`, **still** produces the finding". I wrote it, then reverted
the gate widening to watch it go red — and it stayed green. A `SAIL` step is judged from the `Exit`
itself, which carries the neighbour's terrain, so a *single-step* route never reads the region index
at all; only the second step of a route does. The case had to become a two-step route sailing out of
ocean before it bit.

**Why.** The plan reasoned correctly about *what* had to be pinned and picked a fixture that could
not pin it. The trap it was guarding against ("forgetting to add this code to that condition leaves
multi-step routes unjudged") names *multi-step* in its own sentence; the fixture was single-step.

**Cost.** About ten minutes, and only because I ran the mutation. Left as written it would have cost
nothing visible and shipped a test asserting the opposite of what its comment claimed.

**Prevent by.** Running the mutation on any test a plan names as the guard for a specific mistake:
make the mistake, watch the named assertion fail, put it back. `implement-bead`'s *Building* section
says to follow the increments in order, and *When the plan is wrong* already asks for a helper the
plan cites to be read before it is built on — the same care is owed to a fixture the plan cites as
proof, and the check is a two-command loop.

**Seen before.** None found — `docs/retrospectives/` has nothing about a specified test that cannot
fail.
