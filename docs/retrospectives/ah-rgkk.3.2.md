# ah-rgkk.3.2 — retrospective

- **Implementer:** Rogue
- **Date:** 2026-09-06
- **PR:** #1010

## The plan prescribed a Rust signature clippy refuses

**What happened.** The plan's *Files to change* section specified, in code, that `move_between`
"gains `line: usize` **and** `party: &super::forms::Party`". `move_between` already took seven
arguments, so the prescribed signature is nine, and `pnpm run check:fast` fails it:
`error: this function has too many arguments (9/7)` from `clippy::too_many_arguments`, which this
repository runs under `-D warnings`. The prescribed shape could not compile, and the fix — bundling
the transfer's own fields into a `Transfer<'_>` struct — had to be invented at the gate, after all
five increments were written and committed against the two-parameter shape.

**Why.** Established. The plan counted the parameters it was adding but not the ones already there,
and nothing between writing a plan and running the gate counts them either: the plan's own
*Validation* section runs `check:fast`, so the failure is by design caught late.

**Cost.** About fifteen minutes — one failed gate run, the struct, three call sites and a re-gate —
plus a `refactor` commit on the PR that would otherwise not exist.

**Prevent by.** When a plan adds a parameter to an existing Rust function, it should state the
resulting arity, and at seven or more should prescribe the parameter struct itself rather than
leaving the implementer to invent one at the gate. `.claude/skills/plan-bead`'s guidance on citing
functions by name could say so alongside its existing "never by line" rule.

**Seen before.** `ah-728m.2.2` — same lint, different damage: there it forced a helper to move and
the move detached two doc comments. Two beads have now paid for `too_many_arguments` arriving as a
surprise at the gate rather than as a fact in the plan.
