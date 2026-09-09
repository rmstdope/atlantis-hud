# ah-4b6n — retrospective

- **Implementer:** Wolverine
- **Date:** 2026-09-09
- **PR:** #1089

## The plan's *Out of scope* named a file the seam does change

**What happened.** The plan states that `effects::settle_headcounts` and the units table
"already settle recruitment from the same ledger and are unaffected by this predicate". They are
affected. Once `recruited_people` stops refusing every `Amount::All`, a `BUY ALL <race>` settles an
exact recruit list, and two tests in `crates/core/src/orders/effects.rs` that pinned the opposite
premise went red on the first full-crate run:
`a_buy_all_records_an_inferred_recruit_count` (`count_inferred` is now `false`, and the race
breakdown is named) and `an_estimated_unit_whose_recruits_never_settled_claims_nothing`
(`recruits_unmerged` flips `false` → `true`, so such a unit now sees a claim it did not see
before). Both were updated to the new truth; the second is a user-visible change the navigator was
not asked about, and it is named in the PR body and answered in the review thread.

**Why.** The plan reasoned about the two *production* surfaces the bead is named for — the SILVER
column and the ITEMS column — and about `Ledger::bought` as their input. It did not walk the other
readers of `UnitItemEffects::recruited`, whose doc comment says in as many words "Empty both when
nothing was recruited **and when a `BUY ALL` makes the exact figure unknowable**". That sentence is
the index of everything the seam changes, and it is one grep away.

**Cost.** About ten minutes of diagnosis and repair, plus one review finding (finding 2 of the cold
read) and the answer it needed. Nothing was rebuilt.

**Prevent by.** When a plan's seam changes *what a shared field carries* rather than only what one
caller does with it, its *Files to change* section should name the field and require a grep for its
other readers before the *Out of scope* claim is written — here,
`grep -rn "recruited\b" crates/core/src/orders/` reaches both broken tests directly, and the
field's own doc comment states the premise they pin.

**Seen before.** None found for this field. `grep -rl "Out of scope" docs/retrospectives/` matches
several files, none about a shared field's other readers.

## A probe reverted with `git checkout --` took uncommitted work with it

**What happened.** To prove increment 3 really was RED, I temporarily restored the deleted amount
guard in `crates/core/src/orders/semantics.rs`, ran the test, and reverted the probe with
`git checkout -- crates/core/src/orders/semantics.rs`. That file also held the whole of the bead's
uncommitted work — the new guard and two new tests — and all of it went. It had to be reapplied
from the session's own scripts.

**Why.** `git checkout -- <file>` restores the file from the index, and nothing in this bead had
been staged or committed yet, so "undo my probe" and "undo everything" were the same command.

**Cost.** About five minutes to reapply, and one wasted `cargo test` cycle. Nothing was lost
permanently only because each edit had been made by a script that could simply be run again.

**Prevent by.** Revert a probe with the inverse edit, not with a whole-file checkout, whenever the
file also holds uncommitted work — or commit the increment before probing, which is what the
increment discipline would have done anyway had the RED proof come before the commit rather than
after it.

**Seen before.** `grep -rl "git checkout --" docs/retrospectives/` matches eight files. The closest
is `ah-1wcw.6`, which records a `git checkout -- <the view files>` restoring the committed version
and so silently changing what a test was measuring — the same command, the same class of surprise:
it restores the index, not the last thing you typed.
