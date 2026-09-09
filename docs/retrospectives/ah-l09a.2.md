# ah-l09a.2 — retrospective

- **Implementer:** Wolverine
- **Date:** 2026-09-09
- **PR:** #1155

## The plan reasoned about one way a unit becomes unread, and there are two

**What happened.** The plan's *Decided by me* said "A unit whose `Weight:`/`Capacity:` line *was*
read keeps its exact figures (the `movement != null` arm is untouched)", and specified the unread
arm as `Weight` = the item-derived floor, else `not known` — no mention of `unit.weight`. I built
that literally. The reviewer's cold read found it was wrong: `crates/core/src/report/unit.rs:184`
sets `UnitRead::Partial` on `line_was_cut_short(body) || bad_field`, and the `bad_field` half fires
on a *fully present* line holding one malformed item. Such a unit has `Weight: 40` genuinely parsed
and `movement == None`, so the pane replaced the report's own `40` with a smaller floor like
`100 or more` — a confident wrong number, which is the exact thing this epic exists to stop.

**Why.** The plan equated "unread" with "the line was cut short", which is the case its *Context*
section is written around and the case its by-hand validation fixture reproduces. `bad_field` is
the other half of the same predicate and never appears in the plan. The `Known traps` section did
tell me to read `.1`'s plan for the shape of `UnitRead`, and I read the *type*; reading the one
function that assigns it would have shown both arms in four lines.

**Cost.** One review round and one fix commit, about ten minutes — cheap only because the reviewer
caught it. Shipped, it would have been a wrong figure on a real unit.

**Prevent by.** `implement-bead`'s *When the plan is wrong* already says a helper the plan cites for
what it decides is read before it is built on. It is written around a helper the plan *names*; this
was an enum whose *variants* the plan reasoned about without naming where they are assigned.
Widening that rule to "read the code that assigns any state the plan branches on, not only the
helpers it names by symbol" would have caught it. Nothing here needs changing for me to have done
better — reading `unit.rs` was one grep away.

**Seen before.** None found — `grep -rl "bad_field\|plan assumed" docs/retrospectives/` returns
nothing.
