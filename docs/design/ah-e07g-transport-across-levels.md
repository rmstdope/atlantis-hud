## Context

Bead: ah-e07g — "TRANSPORT to a quartermaster on another level of the map" (ux:agreed).
Mockup: docs/ui/ah-e07g-transport-across-levels.html (quotes the exact sentence used below).

The engine's hex-distance API returns None when two hexes lie on different z-levels. The agreed UX treats a cross-level TRANSPORT as a definite refusal (the same form as an "out of reach" refusal), not an "unknown distance"/price case. This plan makes the server and client produce the same refusal sentence.

## Files to change, and what to reuse

- crates/core/src/orders/transport.rs
  - Introduce a refusal variant for "different level" and make out_of_reach return it when hex_distance is None.
- crates/core/src/orders/semantics.rs
  - Render the refusal sentence for the two-level case (target level first, sender level second) so findings and the problems list use the agreed wording.
- crates/core/src/orders/effects.rs
  - Propagate the refusal into the transport issue structure; ensure the wire contains the reach shape the client needs.
- packages/core-client/src/generated/TransportReach.ts (generated binding)
  - Accept the new variant on the wire: either {away, limit} or {fromLevel, toLevel}.
- packages/shared/src/unitPreview.ts
  - Make transportTargetSentence render the levels-shaped message when the wire carries {fromLevel,toLevel}.

Re-use: level name logic already exists in core (crates/core/src/report/level.rs). Client copies the same word choices (`nexus`, `surface`, `underworld`, `underdeep`, `abyss`, `level N`) so both sides match.

## Increments

1) Server: refuse cross-level shipments in transport::out_of_reach
   - Failing test: add unit test asserting out_of_reach(...) returns the DifferentLevel variant when `hex_distance` is None for different z.
   - Implementation: enum variant + match on hex_distance(None) -> DifferentLevel(from.z, to.z).

2) Server: render the agreed sentence for different-level refusals
   - Failing test: semantics unit test that the finding message equals the mockup sentence for an example (Unit 900/901 in docs/ui sample).
   - Implementation: format the message as: "Unit {to} is {to-phrase} and this unit is {from-phrase}, so {tail}."

3) Server: wire the levels through to the client
   - Failing test: effects test that TransportTargetIssue.reach serialises as the levels-shaped object for the different-level case (and tests that previous distance-shaped JSON remains unchanged).
   - Implementation: change TransportReach to accept both shapes and ensure the core produces the correct variant.

4) Client: accept and render the new shape
   - Failing test: unitPreview.test.ts gains a case for reach = {fromLevel:1,toLevel:2} producing the exact mockup sentence.
   - Implementation: detect the reach shape and map numeric level -> word; compose the same prepositions as server ("on the surface", "in the underworld", "on level N").

5) Validation: run the focused test set and smoke check
   - Commands: in an implementer worktree based on origin/main
     - cargo test -p core --lib
     - pnpm --filter @atlantis/shared test
     - pnpm run check:fast (optional full-fast gate)

## The test plan

- Unit tests added/updated in crates/core (transport.rs, semantics.rs, effects.rs) and packages/shared (unitPreview.test.ts) to exercise both distance and levels cases.
- Run the two focused test commands above. The change touches generated bindings (core-client/src/generated/TransportReach.ts) so ensure that file is updated and committed.

## User-facing decisions

### Agreed with the navigator

- Cross-level TRANSPORT orders are treated as a refusal and reported exactly like an "out of reach" refusal.  The mockup example sentence (quoted verbatim) is:

  "Unit 901 is in the underworld and this unit is on the surface, so 9 FUR stay with this unit."

- The Problems list, Orders editor warning and Unit preview must all read identically.

### Decided by me

- The refusal will name the target's level first, then the sender's level, then the tail (what stays). This mirrors the established numeric refusal sentence order and keeps client/server strings parallel.
- The Settings dialog's transport warning description will be extended to mention "on another level" so silencing still covers this case.

## Out of scope

- Changing the game rules: the plan does not attempt to change whether the engine actually ships between levels. It implements the chosen UI assumption (treat as refused). If the engine later documents explicit cross-level carriage, the plan will be revisited.
- Changing pricing for numeric cases (no change to priced() behavior is required because the out_of_reach gate is checked first).

## Validation

- Commands (from a branch created off origin/main in a worktree):
  - cargo test -p core --lib
  - pnpm --filter @atlantis/shared test
  - pnpm run check:fast

- Manual verification steps:
  1. Open the mockup scenario (docs/ui/ah-e07g-transport-across-levels.html) and confirm the sentence appears as quoted in the Orders editor and Problems box.
  2. Load the application (dev server) and reproduce: create a report where sender.z == 1, target.z == 2; write the TRANSPORT order and confirm the Problems line and Unit preview show the exact sentence and that no charge/transfer occurs.

## Known traps

- The plan-bead template expects the agreed text in the bead's `acceptance` field; this bead stores it as `acceptance_criteria`. Implementer note: either copy `acceptance_criteria` into `acceptance` before marking planned, or read `acceptance_criteria` when implementing. Document this in the bead's design attachment.

- Wire type changes: the TransportReach shape is part of the API (core -> client). Update the generated TypeScript binding (packages/core-client/src/generated/TransportReach.ts) and commit it; CI enforces that generated bindings are kept in sync.

- Tests and CI: update and run the focused tests locally before opening a PR. The shared package's tests use vitest and require node sandbox options; run them as in the test plan.


---

Design prepared by: Iceman (build-design pass)
Mockup: docs/ui/ah-e07g-transport-across-levels.html

