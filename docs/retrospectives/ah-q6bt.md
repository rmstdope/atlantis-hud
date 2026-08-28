# ah-q6bt — retrospective

- **Implementer:** Wolverine
- **Date:** 2026-08-28
- **PR:** #785

## The plan's own doc-comment snippet violated the plan's own acceptance criterion

**What happened.** Acceptance criterion 2 read:

```
grep -n "combat_ready_in" crates/core/src/   # returns nothing
```

*"the function that swallowed the warning is gone, not merely bypassed."* But the plan's *Files to
change* section prescribed, verbatim, the doc comment to put on the replacement:

```rust
/// Replaces `combat_ready_in`, which summed every own unit in the hex and answered `None` if any
/// one of them could not be counted ...
```

Writing the plan's snippet as given leaves the identifier in `crates/core/src/` and fails the
criterion. There were five occurrences in the end: two genuinely stale references that had to be
repointed anyway, and three deliberate historical ones — the plan's snippet among them.

**Why.** The criterion was written against the *code* and the snippet against the *reader*, and
nothing re-ran the one over the other. `grep` does not distinguish a call site from a doc comment.

**Cost.** About ten minutes deciding whether to honour the letter or the intent, and a paragraph in
the PR body. No CI cycle. I honoured the letter — the historical references now say "the hex-wide
count this replaced" and name the bead — but the tempting wrong move is visible from here: an
implementer that satisfies the grep by *deleting* those comments throws away the reasoning the plan
wrote them for.

**Prevent by.** `plan-bead`'s acceptance-criteria step already has to run each grep it writes
against `origin/main` (`ah-qled.8`). It should also run it against **the plan's own prescribed
snippets** — or, where a symbol is deliberately named in prose, say so in the criterion itself:
`returns only the doc comments in <section>`. A criterion phrased as a command is a promise that
the command will be run literally.

**Seen before.** `ah-qled.8` — a grep-shaped acceptance criterion that no work in that bead could
make pass. `ah-wltt` — an acceptance criterion counted with a different command from the one that
set its baseline. Third sighting of the same family: grep-shaped criteria that were never run.

## A fully specified function signature omitted the one input state that yields a confident wrong number

**What happened.** The plan specified `price_pillage` down to its four arms and its exact signature:

```rust
pub fn price_pillage(tax_base: Option<i64>, pillagers: Option<Pillagers>, mine: i64) -> Priced;
```

`mine` is the pillaging unit's own combat ready men. The plan never said what to pass when *that
unit* is the one whose men cannot be counted — the state its own decision U1 is entirely about. With
`mine: i64` there is only one thing to pass, `0`, and in a hex where another pillager already clears
the threshold that produces a **certain `$0`** in the SILVER column beside a warning reading *"may
not be able to pillage here"*: the two surfaces contradicting each other about one order, which is
what `tests/silver_agrees_with_the_warning.rs` exists to catch and what `ah-abwx` and `ah-ycuj`
already cost this project two beads.

**Why.** The plan reasoned about `Pillagers::incomplete` as a property of the *hex* throughout, and
correctly said the warning's branch must be chosen from each unit's own readiness. It did not carry
that same per-unit distinction across to the column's input.

**Cost.** No wasted work — it was caught by reasoning before the first increment that used it, and
shipped as `mine: Option<i64>` with a test (`a_hedged_pillager_is_doubted_by_the_column_too`) and a
deviation note in the PR. Recorded because the failure it was one step from is silent: every test
the plan actually named would have passed with the zero.

**Prevent by.** When a plan writes a function signature verbatim, each parameter that is **not** an
`Option` should be checked against the states the plan elsewhere calls unknowable, and the plan
should say what is passed in each. Here the plan named exactly that state two sections earlier —
*"`readiness` returned `None` for this unit"* — and the signature had no way to express it.

**Seen before.** `ah-4ao` — a guard the plan's own function spec left out, found only by running the
code. Same class: a spec detailed enough to be trusted, with one input state missing.
