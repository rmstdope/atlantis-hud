# ah-gdd3.1 — retrospective

- **Implementer:** Rogue
- **Date:** 2026-09-03
- **PR:** #907

## A plan's parenthetical about current behaviour was false, and I followed it into a regression

**What happened.** The plan supplied the restructured phase-major dispatch as pasteable code, and
justified one line of it with a claim about the tree as it stood: *"`settle_buy_all` stays
immediately after the unit's own market orders, **which is where it is today relative to that
unit**"*. It was not. It ran after the unit's whole block, and its own doc at
`crates/core/src/orders/semantics.rs` said so — *"once the rest of its month has been applied"*. I
pasted the loop, kept the claim, and shipped a real defect: `settle_buy_all` reads
`balance_at(StatePhase::Maintenance, …)`, which carries only deltas already *applied*, so settling
it inside the market phase spent silver the unit's own STUDY and manufacturing PRODUCE had not yet
been charged for — and disagreed with `forecast_unit`, which settles its deferred `BUY ALL` after
its whole walk. `BUY ALL grain` above `STUDY combat` bought all ten grain instead of nine. **No test
in the repository caught it**: the 26-turn corpus in `silver_agrees_with_the_warning` has no
`BUY ALL` beside a month-long spend, so the whole suite, `check:fast` and eleven CI jobs were green
over it. The review sub-agent's first cold read found it, and I reproduced it before fixing.

**Why.** `implement-bead`'s *When the plan is wrong* already says a current-source claim the plan
relies on is checked before its increment begins, and names *"the old side of a proposed diff"*
specifically. I applied that rule to the symbols the plan told me to call and not to a parenthetical
inside a code block — the claim did not look like a claim, it looked like reassurance attached to
code I was about to paste.

**Cost.** One review round and one fix commit, about 20 minutes. Cheap only because the reviewer
caught it; had it merged, the Silver column and the warning ledger would have disagreed for any unit
buying with `BUY ALL` beside a month-long order, and nothing in the suite would have said so.

**Prevent by.** `implement-bead`'s *When the plan is wrong* should say that a **parenthetical
justifying a line of supplied code** is a current-source claim like any other — *"which is where it
is today"*, *"as it already does"*, *"unchanged from"* — and is verified by opening the code, not by
reading on. The three-word tell is a plan asserting where existing code *runs*, as opposed to what it
*does*: ordering claims are exactly the ones a suite this large can be green over.

**Seen before.** `ah-wltt` — same family, and its *Prevent by* is nearly the same sentence:
"literal code in a plan is followed literally, and a wrong snippet costs more than no snippet". That
is now twice, which is the argument for the rule living in `implement-bead` rather than in two
retrospectives.

## A new private helper silently stole a public function's doc comment and `#[must_use]`

**What happened.** I inserted `available_silver` immediately above `pub fn forecast_unit` in
`crates/core/src/orders/silver.rs`. It landed *between* the existing `#[must_use]` and the function,
so ~13 lines of doc and the attribute re-attached themselves to the new private helper, leaving the
public function undocumented and un-`must_use`d. `cargo build`, the full test suite,
`cargo clippy --all-targets -- -D warnings` and `cargo fmt --check` all pass, in both states.

**Why.** My insertion script anchored on the `fn` signature and walked back over `///` lines only,
so it stopped *below* the `#[must_use]` line rather than above the whole attached block.

**Cost.** Small on this bead — the reviewer caught it and the fix was a move — but it is silent by
construction, which is the reason to record it: nothing in the toolchain says a word.

**Prevent by.** When adding an item directly above an existing one, `git diff` the *hunk header*
rather than the new lines: a correct insertion shows the neighbour's `#[attr]` and doc untouched
below it. Anchoring on a bare `fn` name is the trap — attributes sit between the doc and the
signature, so "insert above the doc comment" means above the attributes too.

**Seen before.** None found — `grep -rl must_use docs/retrospectives/` returns nothing.

## `gh pr diff <n>` returned a truncated diff, omitting two files entirely

**What happened.** `implement-bead`'s *Getting the review* says a cold read gets three things, the
first being the diff via `gh pr diff <n>`. The reviewer reported that `gh pr diff 907` **came back
truncated and omitted `crates/core/src/orders/silver.rs` and the whole new integration test
`crates/core/tests/phase_silver_for_a_cast.rs`** — one of the two changed economy computations, and
the bead's required regression. It fell back to `git diff origin/main...HEAD` in the worktree and
reviewed the real change.

**Why.** Not established. The diff is ~810 added lines across five files, which is not obviously
large; I did not reproduce it myself, so I cannot say whether it is a size cap, a rendering limit or
something about this PR.

**Cost.** None here, because the agent noticed and said so. The cost it *risks* is total: a cold read
that silently receives two-thirds of a diff produces a confident "no findings" about code nobody
read, and neither the implementer nor the navigator can tell from the posted review.

**Prevent by.** `implement-bead`'s *Getting the review* should name `git diff origin/main...HEAD` (in
the worktree, which the sub-agent has) as what the reviewer takes, with `gh pr diff` as the fallback
rather than the instruction — the delta rounds already tell it to take `git diff <a>..<b>` itself for
exactly this reason, and the cold read is the round where an incomplete diff does the most damage.

**Seen before.** None found for a truncated `gh pr diff`.
