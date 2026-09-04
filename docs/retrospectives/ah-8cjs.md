# ah-8cjs — retrospective

- **Implementer:** Storm
- **Date:** 2026-09-04
- **PR:** #923

## Two of the plan's five tests did not discriminate as written

**What happened.** The plan specified each test's fixture and assertion exactly, and two of them
would have passed against the unfixed code.

- Increments 2 and 3 prescribed `preview_over(&report, "unit 900\nFORM 1\nEND\n")`. A formed unit
  that gains nobody is dissolved (`rules/form`), so the preview held no regions at all and the test
  panicked on `regions[0]` rather than on the flags. A `GIVE NEW n 1 LEAD` fixes it, and the nested
  case needs the forming unit to carry two men so both formed units survive.
- Increment 5 expected an uninherited `sharing` to produce a per-unit `Verdict::UnitShort`. It does
  not: the hex has other sharers, so an overdrawn non-sharer is `DeferredToPool` either way. The
  reading that actually moves is `claims_pool` — false for a sharer, whose overdraft is already
  inside the purse's sum. Asserted as written, the test was green before the change.

**Why.** Both are cases where the plan reasoned about the *field* being read (`flags`) without
running the surface that reads it. `formed_unit`'s dissolution rule and `judge_shortfalls`'
`claims_pool` are each one step downstream of the flag, and each swallows the difference.

**Cost.** About fifteen minutes, all of it inside the increments; no CI cycle and no review round.

**Prevent by.** After writing each increment's test, run it against the *unfixed* code and require
it red for the stated reason before writing the fix — `implement-bead` says "each opening with its
named failing test" but not that a red for the wrong reason (a panic on an empty fixture) is not the
red the increment asked for. Where a test is written after its production code, as increments 3–5
here were, revert the one line it pins and watch it fail; that is what caught increment 5.

**Seen before.** `ah-dhga` and `ah-66yi` both record the dissolution rule surprising a test fixture,
so this is its third sighting. None found for the `claims_pool` half.
