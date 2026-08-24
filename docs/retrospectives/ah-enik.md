# ah-enik — retrospective

- **Implementer:** Storm
- **Date:** 2026-08-24
- **PR:** #646

## The plan's own anti-vacuity guard was itself near-vacuous, and so was the loop it guarded

**What happened.** The plan specified the new test code verbatim, including an increment titled
"a guard against the assertion going vacuous" that cited ah-ycuj by name. Written exactly as
specified, that guard asserted `required > 20` and `optional > 0` against a live source that has 99
required and 14 optional parameters — so it still passed with 78 of the 99 misclassified, which is
the same shape of hole ah-ycuj records. The plan's main loop had the matching problem: it wrote
`parameters[entry.command] ?? []` directly beneath a comment saying "this is exhaustive: there is no
command it can skip", where the `?? []` *is* the silent skip. Both were found by the adversarial
review in the REFACTOR phase, not by me writing the code, because I typed what the plan said.

**Why.** A plan that prescribes test code as a literal block invites it to be transcribed rather
than reasoned about, and a comment asserting a property sits right beside the code that breaks it —
which reads as confirmation. The countermeasure the repository already trusts (ah-ycuj's lesson,
"measure the corpus before asserting on it") was named in the plan's prose but never applied to the
plan's own numbers: nobody had counted the parameters.

**Cost.** Small — about ten minutes inside the REFACTOR phase, no extra CI cycle, caught before the
commit. It is recorded because the cost if the review had not caught it is the bead shipping a test
that reads as a guarantee and is not one, which is exactly what ah-ycuj cost a year of.

**Prevent by.** When a plan supplies a threshold or a defaulting expression inside a test, measure
the live value before accepting it — one command (`Object.values(parameters).flat().length` here) —
and treat any `?? []`, `?.` or `|| 0` in an exhaustiveness assertion as a defect by default: the
whole point of such an assertion is that a missing row throws. Both belong in `plan-bead`'s guidance
about writing test code into a plan, if the navigator wants them there.

**Seen before.** `ah-ycuj.md` — "A corpus assertion was vacuously true for 758 of the 1,392 units,
and only the reviewer caught it". Same failure mode, one bead later, this time written into the plan
that was citing it.
