# ah-rgkk.4.1 — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-09-06
- **PR:** #1012

## The plan's guard on the hand-mirrored Rust→TypeScript boundary did not actually guard it

**What happened.** The plan's increment 3 said to change the `itemChanges` literal in
`packages/shared/src/unitPreview.test.ts` to carry the new field, and that this "fails `tsc` until
`index.ts` has the field, which is the RED". It did not.
`pnpm --filter @atlantis/shared exec tsc --noEmit -p .` passed with `isMan: true` present in the
literal and absent from `ItemChange`. The literal is bound to a `const` and then passed by name into
`previewedRow({}, { itemChanges })`, so TypeScript's object-literal freshness is lost at the binding
and excess-property checking never fires. Annotating the literals `const itemChanges: ItemChange[]`
is what produced the RED (`TS2353`), and it then also flagged a second literal further down the same
`describe` block that was silently unchecked in exactly the same way.

**Why.** Excess-property checking applies only to *fresh* object literals at the assignment site. A
literal assigned to an un-annotated `const` gets a widened inferred type, and every later use checks
against that inferred type rather than against `ItemChange`. So the file's `toEqual` round-trip
proved the value survived `mergePreview`, which it does — it never proved the value matches the
mirrored type.

**Cost.** About ten minutes, and no CI cycle: the missing RED was caught while running the increment
rather than after. The larger cost is counterfactual and is why this is worth writing down. This
boundary has no ts-rs, no zod and no decoder — the plan's own *Known traps* says "a field added on
one side and forgotten on the other compiles, passes CI, and reads as `undefined` at runtime.
Increment 3's test literal is the only thing standing there". That literal was not standing there.

**Prevent by.** Where a plan nominates a test literal as the check on a hand-mirrored boundary, the
literal must carry an explicit type annotation (`const x: ItemChange[] = [...]`), not rely on
inference. Two concrete places this could be made structural rather than remembered: a rule in
`packages/core-client`'s own tests asserting the mirrored types against a sample payload, or the
`plan-bead` guidance saying that "changing a test literal" is only a RED when the literal is
annotated. Worth a look at the other hand-mirrored types in `packages/core-client/src/index.ts` for
literals with the same shape, since the same blind spot will be there.

**Seen before.** None found — `grep -rl "excess" docs/retrospectives/` returns nothing.
