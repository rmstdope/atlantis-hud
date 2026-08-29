# ah-jpcj.2 — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-08-29
- **PR:** #800

## The plan asserted a pluralisation its own cited helper does not do

**What happened.** The plan specified every summary string byte for byte, including
`11 hexes added to your map from 2 map exports.`, and said of the helper that produces it:
"`count` (`:59`) is the existing helper and gives `1 hex` / `11 hexes`. Reuse it; do not write a
second pluraliser." `count` in `packages/shared/src/importSummary.ts` appends a bare `s`, so it
gives `11 hexs`. Four tests failed on exactly that character.

**Why.** Established. `count` is `` `${n} ${noun}${n === 1 ? "" : "s"}` `` and was written for
`turn`, `allied report`, `file` and `line` — every noun it had until now took a plain `s`. `hex` is
the first irregular one, and the plan asserted the helper's behaviour from its call sites rather
than from its body.

**Cost.** About a minute: the plan's own test table specified the strings, so the RED tests named
the defect immediately and no implementation was wasted. The plan's two instructions were in
tension — reuse `count`, and produce `hexes` — so the resolution (give `count` an optional plural,
keeping one pluraliser) was a small judgement rather than a hand-back.

**Prevent by.** Nothing new. `implement-bead`'s *When the plan is wrong* already says to read a
cited helper's body before building on it, and that is what caught this. What is worth noting is
that the cost stayed near zero **only because the plan specified the output strings verbatim**: had
it said "reuse `count`" without the table, `11 hexs` would have shipped and been found by a person.
The verbatim table is the guard, and it earned its place here.

**Seen before.** `ah-ofpb.2` — same class, a plan wrong about a helper it named (its
`with_ledger` finding records "none found"; this is a second sighting). `ah-wbr9` — a plan's
verbatim user-facing message could not be produced by the rule the same plan gave, which is this
one seen from the other end.
