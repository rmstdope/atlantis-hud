# ah-ofra — retrospective

- **Implementer:** Rogue
- **Date:** 2026-09-12
- **PR:** #1204

## A scripted insertion welded two doc comments onto their new neighbours, and only the reviewer saw it

**What happened.** Every edit in this bead was made with `python3 - <<'PYEOF'` string replacement
against an anchor. Two of those anchors were the first line of a new item placed directly below an
existing documented item, so the new `///` block joined the end of the existing one: `OrderedUnits`'s
doc comment in `crates/core/src/movement/fleet.rs` ended up prefixed to `UnitCourse`'s, and
`check_sailing`'s weight/ledger/crew explanation in `crates/core/src/orders/semantics.rs` ended up on
`check_fleet_course`. Both public/documented items were left with no doc comment at all, and the
merged blocks read as one broken thought. `cargo clippy`, `cargo fmt --check` and 2 745 tests were
all green over it — nothing mechanical looks at whether a doc comment describes the item under it.
The review sub-agent's cold read found both.

**Why.** An anchor-based insertion is blind to what precedes the anchor. `#[derive(...)]` or
`fn foo(` is a correct, unique anchor *and* the wrong place to insert when the lines above it are a
`///` block belonging to the item the anchor names.

**Cost.** One review round and one fix commit, about ten minutes — cheap only because the reviewer
read it. Unreviewed it would have shipped two undocumented public items.

**Prevent by.** This is the fourth sighting of the same class (see *Seen before*), and the
prevention those recorded — "after any scripted edit, `git diff` that file and read it" — is right
and was not followed here. The narrower rule this bead adds: when a scripted insertion's anchor is a
`#[derive]`, `#[serde]`, `struct`, `fn` or `const` line, the insert point is **above the `///` block
that precedes it**, not above the anchor, and the diff must be read at that hunk before the commit.
`git diff -U12` is what shows it; `-U3` does not reach back far enough to show whose doc comment the
new text landed inside.

**Seen before.** `ah-0w7w-reopened` (scripted edit replaced the first of several matches; *Prevent
by* names reading the diff), `ah-1zca.5` (an unchecked scripted `str.replace` reported a review
finding fixed when it was not — "again"), `ah-2a96` and `ah-bu2c` (same scripted-edit shape across
six spec files, shipped something wrong).

## Running the full smoke suite locally guaranteed the branch would be behind, twice

**What happened.** The plan's *Validation* asked for `pnpm run test:smoke` locally, which it argued
for on good grounds: this bead edits specs that assert route lines. The run took **15.6 minutes**. In
that window main gained a merge, so the push that followed read `CONFLICTING DIRTY`; the local rebase
and re-gate took another ~15 minutes, main gained a second merge (#1201), and the branch was behind
again. Two rebases, both with real content conflicts — `codes::ALL`'s length constant and its list,
the `FleetOrders` import beside a new `may_leave_land`, `RouteProblem::CrewCannotSail` having become
`FleetOverloaded { load, capacity, crew }`, and two test files whose new blocks both landed at EOF.

**Why.** With several implementers merging, main's mean time between merges is well under the
duration of a full local browser run, and every one of this bead's five touched files is one other
sailing beads touch. The local run is not what caused the conflicts — it is what guaranteed they
would be discovered after the gate rather than before it, so the gate was paid for twice.

**Cost.** About 40 minutes: one 15.6-minute smoke run, two rebases with conflict resolution, two
re-gates, one regenerated vocabulary.

**Prevent by.** When a plan asks for a local browser suite on a bead touching contended files, run
it **before** opening the PR and treat the following gate as the last thing before the push, with no
review round in between — or accept CI's own `smoke (web|desktop-shell, 1..2, 2)` jobs as the gate,
which is what `implement-bead`'s *Building* section already says they are. A plan's *Validation*
section asking for a 15-minute local suite should say which it intends, because running it and then
spending an hour in review is the one order that pays for it twice.

**Seen before.** None found for this shape specifically; `ah-fvzu`, `ah-728m.2.1`, `ah-dhga`,
`ah-j2w` and `ah-tdsi` mention rebases, none for a local-suite window.

## A fixture's own saved orders made the plan's smoke scene unreachable

**What happened.** The plan's smoke spec described the silent tail — owner orders nothing, a helper
orders a course, the map draws nothing. Written against `turn-24.rep` it failed, and the failure
text showed why: that fixture's saved order document already gives Raft [235]'s owner `SAIL SE NE`,
so the assertion met the *overruled* tail instead. The spec was reshaped to assert the overruled
case (which is the richer of the two) and the silent tail is covered by the Rust acceptance test.

**Why.** A plan can name a scene by its report fixture without accounting for the orders the fixture
already carries; the two are separate files and only one of them is obvious from the report text.

**Cost.** Two smoke runs of the single spec, about five minutes.

**Prevent by.** A plan that specifies a browser spec's starting state should name the fixture's
existing orders for the units involved, or say that the spec must write every unit's block it
depends on. `fillOrders` replaces only the selected unit's block, so every other unit aboard keeps
whatever the fixture saved.

**Seen before.** None found.
