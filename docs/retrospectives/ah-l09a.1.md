# ah-l09a.1 — retrospective

- **Implementer:** Wolverine
- **Date:** 2026-09-09
- **PR:** #1153

## A corpus measurement over `tests/fixtures/reports/` missed `tests/fixtures/atlaclient/`

**What happened.** The plan justified a deliberately blunt detector by measuring every region unit
logical line in `tests/fixtures/reports/` — 5613 of 5613 end with `.` — and specified a corpus sweep
over `atlantis_hud_fixtures::ALL` as its false-positive net. That sweep passed. What failed was
`report::atlaclient::tests::the_fixture_parses_with_nothing_unreadable`, on
`tests/fixtures/atlaclient/atlaclient-map-t16.txt`, which is *not* in `ALL`:

```
cargo test -p atlantis-hud-core
unreadable: [UnreadableLine { kind: Unit, line_start: 218, ... unit_read: Some(Nothing) }, ...4 rows]
```

Not a false positive. That map export is wrapped at ~66 columns, and line 218 —
`- scout (6910), Old Pathfinders (137), avoiding, behind, gnoll` at 62 columns — genuinely orphans
its `[GNOL].` fragment. Four units in a committed fixture have been losing their items silently, in
the repository, all along. The test asserting "nothing unreadable" was asserting the defect.

**Why.** `atlantis_hud_fixtures` has two corpora with different shapes — `ALL` (turn reports) and
`ALL_ATLACLIENT_MAPS` — and the plan's measurement, its sweep and its trap list all reasoned about
the first only. Nothing in the fixtures crate makes the second visible to someone looking at `ALL`.

**Cost.** About ten minutes: one full `cargo test` run to discover, then reading the fixture by hand
to establish it was a real loss rather than a detector fault before touching the assertion.

**Prevent by.** A plan whose evidence is "measured across every committed fixture" naming which
constant it walked, and `crates/fixtures/src/lib.rs` saying at `ALL` that it is the reports only and
that `ALL_ATLACLIENT_MAPS` exists beside it. `ah-l09a.2`, `.3` and `.4` inherit this: the atlaclient
map now has four units marked as unread, so any test of theirs that walks fixtures will see them.

**Seen before.** None found.

## A plan that rewrites a user-visible string still has to name the smoke specs asserting it

**What happened.** The plan's *Test plan* said "**No browser suite.**" and listed the new footer
sentence as a Vitest change only. `tests/smoke/workspace.spec.ts:3224` asserted the old sentence
verbatim and would have gone red in CI. The review sub-agent caught it before the first CI run.

**Why.** The plan reasoned about the smoke suite as a place a *new* test might go, not as a reader of
the strings the bead rewrites. One line would have found it:
`grep -rn "None of this reached the map" tests/smoke/`.

**Cost.** None here — the review caught it — but only because the reviewer went looking beyond the
diff. It cost `ah-rgkk.3.3` a CI cycle for the same reason.

**Prevent by.** `design-the-build` requiring that a plan changing any user-visible string carry the
grep for that string across `tests/smoke/`, and list what it found, rather than asserting that no
browser suite is involved. This is the second sighting.

**Seen before.** `ah-rgkk.3.3` — "A plan that rewrites a user-visible string has to name the smoke
specs asserting it", same cause, discovered in CI rather than in review.
