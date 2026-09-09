# ah-ud89.4 — retrospective

- **Implementer:** Rogue
- **Date:** 2026-09-09
- **PR:** #1135

## Two review rounds went entirely on a comment asserting a reason the code did not support

**What happened.** The cold read found that this bead's purse term and `ah-ud89.2`'s clamped in
different places, so one unit's two `BUY` forms could size one purse two ways. Fixing it took one
commit. *Explaining* it took two more, and both were wrong in the same way. The first said the column
subtracts before its clamp "as `semantics::buy` subtracts it before its own" — true when written,
false the moment the fix moved `buy`'s term. The second said the placements must differ "because this
arm has the month's own `Sold` credit to add first", which does not follow: `semantics::buy` adds
`overcharged` first and still clamps between, as the reviewer demonstrated by writing out the
analogue. The real constraint is narrower — the clamp cannot rise *above* `Sold`, and below it either
side of the subtraction would do. Each wrong version passed `pnpm run check:fast` and eleven CI jobs,
because neither is a statement a compiler or a test can read.

**Why.** A comment justifying *why the code is shaped this way* is a claim about the space of shapes
that would also work, and that space is not in front of you while you edit one line of it. The
subtraction I could check by running the tests; the counterfactual I could only check by writing the
alternative out and seeing whether it broke anything, which is what the reviewer did both times and I
did neither time.

**Cost.** Two delta rounds and two gate runs, about twelve minutes of the bead's wall-clock, plus a
PR body edit each time because the same claim was in the *Deviations* bullet.

**Prevent by.** `implement-bead`'s *When the plan is wrong* already says a helper a plan cites for
what it decides is read before it is built on, and that a sentence in a PR body about what a helper
does is read with a plan's trust. The same care is owed to a **causal** claim in a code comment —
"the placements differ because X", "this cannot be moved" — and the check is the same shape: write the
alternative out and see whether it actually breaks. Worth a line beside the existing one, since a
comment is the one artefact in a bead that no gate reads.

**Seen before.** `ah-12h7` — adjacent rather than the same: there a plan's enumeration of prose to
update was incomplete and the fix was to grep for the stale wording. Here the wording was fresh and
the *reasoning* in it was unsupported, which no grep finds.
