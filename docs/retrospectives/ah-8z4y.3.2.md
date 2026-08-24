# ah-8z4y.3.2 — retrospective

- **Implementer:** Wolverine
- **Date:** 2026-08-24
- **PR:** #665

## A stale line number from the plan shipped into a doc comment, and my own diff moved it further

**What happened.** The plan quoted the desktop's two `ORDER BY` clauses as
`core-persistence/src/lib.rs:1457` and `:1543`. I copied both verbatim into the doc comments of the
two new core functions, because the whole point of those comments is to send a reader to the SQL
that implements the order they define. Copilot's review caught both: by then `:1457` was the doc
comment for `upsert_merged_report` and `:1543` was inside the unrelated `upsert_order_draft`.

They were wrong twice over. They were already stale when the plan was written, and this PR then
shifted them a second time by moving `MergedReportRecord` out of `core-persistence` — so a reference
that had been merely stale became stale *because of the diff carrying it*.

**Why.** Established. A line number in a doc comment points across a crate boundary at a file the
comment's own PR is free to edit, and nothing checks it — not the compiler, not clippy, not any
gate. Unlike a plan's line numbers, which are read once and discarded, this form ships and goes on
misleading readers indefinitely.

**Cost.** One CI cycle (~12 minutes) for the fix commit. The review caught it, so nothing reached
main; had the reviewer not been looking at those two hunks it would have.

**Prevent by.** Two specific changes, both cheap:

1. **`plan-bead`'s house style should forbid a bare cross-file line number in text destined for a
   doc comment**, and require the symbol instead — `core-persistence`'s `load_merged_reports`, not
   `lib.rs:1522`. A symbol survives every edit that does not rename it, and a rename is a
   grep. This is what the fix commit did.
2. Where a plan does cite line numbers for the implementer's own navigation, saying so explicitly
   ("for finding it, not for quoting") would stop the next implementer copying them into shipped
   source as I did.

**Seen before.** Three, all the plan-side half of this and all recorded as line drift the
implementer must work around:
`docs/retrospectives/ah-fvzu.md` (a plan quoting `silver.rs:495` that had drifted six hundred
lines), `docs/retrospectives/ah-8m0.3.md` (cited symbols and describe-blocks that did not exist at
all, whose *Prevent by* already asks planners to paste the current signature rather than cite a
line), and `docs/retrospectives/ah-3pr9.md` (a spec's line number moved 358 → 458 for the same
underlying test). **This is the fourth sighting, and the first where the stale reference reached
tracked source rather than being discarded with the plan** — which is why the prevention above is
about doc comments specifically and not about plans again.

## The plan put a function in a crate that cannot see the type it sorts

**What happened.** The plan specified `order_merged_reports(records: &mut [MergedReportRecord])` in
`crates/core`. `MergedReportRecord` was defined in `crates/core-persistence`, which depends on
`core` and not the other way round, so the signature as written cannot compile. I moved the type
into `core::report::merge` and re-exported it from `core-persistence`, which is the shape the bead
wanted anyway — one definition — but it was a decision taken at the keyboard rather than in the
plan. The same happened smaller with `StoredSighting` (already existed in `core::report::merge`,
plan proposed a new one) and `RememberedRegion` (already exists in `core::movement::graph` with a
*typed* payload; I named mine `RememberedSighting` to avoid two same-named types in one crate).

**Why.** Established. The plan named a type by its bare name without checking which crate defines
it, and the two crates' dependency direction makes that difference decisive rather than cosmetic.

**Cost.** Small — about 15 minutes of rework and three deviations to write up in the PR body.
Recorded because the check that would have caught it is nearly free.

**Prevent by.** When a plan proposes a new function in crate A over a type it names, it should state
which crate defines that type and confirm A can see it. For this workspace the direction is
`core-persistence`/`core-tauri`/`core-wasm` → `core`, never back. A one-line `grep -rn "struct
<Name>" crates` at plan time answers it.

**Seen before.** None found for the crate-dependency-direction case;
`docs/retrospectives/ah-8m0.3.md` is the nearest neighbour, being about a plan describing a file
shape that did not exist.
