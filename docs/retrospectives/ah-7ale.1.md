# ah-7ale.1 — retrospective

- **Implementer:** Rogue
- **Date:** 2026-09-12
- **PR:** #1196

## The plan prescribed an expression clippy refuses, and told me not to change it

**What happened.** The plan's *Files to change* wrote the shipping rate as
`Some(((4 - i64::from((level + 1) / 2)) * 5).max(5))`, and its *Known traps* said, of that
expression and its sibling, "Do not 'simplify' either expression to floating point or to a rounded
form." `pnpm run check:fast` then failed the clippy leg:
`error: manually reimplementing div_ceil ... consider using .div_ceil(): level.div_ceil(2)`, from
`clippy::manual_div_ceil` under `-D warnings`. The two instructions cannot both be followed as
written: the literal form does not compile under the gate, and the form that does is the one the
trap note reads as forbidden. I used `level.div_ceil(2)` — identical for every `u32`, and the
catalogue's own expression kept verbatim in the comment beside it — and recorded the deviation in
the PR body.

**Why.** Established. The plan wrote Rust rather than arithmetic, and a plan's code is not run
through the gate's lints before it is filed. The trap note compounded it: it was aimed at a real
hazard (rounding the catalogue's truncating division), but it was worded as "do not change this
expression" rather than "do not change what this expression computes", so a lint-mandated rewrite
that preserves the arithmetic exactly reads as a violation.

**Cost.** One fast-gate cycle, about four minutes, plus the judgement call about whether the
deviation needed a hand-back. Small — but the same class of failure cost PR #1010 all five of its
increments.

**Prevent by.** Where a plan states a formula, state it as arithmetic and its source
(`data/quartermaster`: `4-((level+1)/2) * 5`, truncating) and let the implementer write the Rust the
gate accepts; where it states Rust, `plan-bead`'s own checks should not also forbid changing it.
A trap note about a formula should say what must be preserved — the truncation, the floor — rather
than which characters must appear.

**Seen before.** `ah-rgkk.3.2` — the same class exactly: the plan prescribed, in code, a Rust
signature `clippy::too_many_arguments` refuses under the same `-D warnings` gate, and the fix had to
be invented at the gate after every increment was written against the prescribed shape. Two
sightings now, both Rust, both clippy, both a plan writing code rather than intent.
