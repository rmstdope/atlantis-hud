# ah-l9mp — retrospective

- **Implementer:** Wolverine
- **Date:** 2026-08-19
- **PR:** #471

## Three CI cycles chasing a failure that a branch update made vanish

**What happened.** `smoke (desktop-shell, 2, 2)` failed on `a folded panel shrinks to its title bar`
(`expect(strip.y).toBeCloseTo(open.y, 0)` — expected 85, received 121) plus one or two neighbouring
geometry specs. It failed on the initial run, on Playwright's own retry, on a full job re-run *and*
its retry, and again on a fresh push — four attempts, which is well past what reads as a flake. The
same specs passed locally every time, including `--repeat-each=4` and a full local
`--project=desktop-shell --shard=2/2` run. Reading the CI page snapshot suggested a wrapped header,
so I spent a commit tightening the level control into the faction group to buy header width. That
changed nothing. Catching the branch up with main (`update-branch`) turned every check green with no
further code change.

**Why.** Not established. The branch was based on a main from before three merges landed
(#469, #470, #472); something in them settles the layout these specs measure. I did not prove which,
and the tightening commit remains in the diff as a defensible change that was not the fix.

**Cost.** Three CI cycles and roughly 40 minutes, plus one commit written against a misdiagnosis.

**Prevent by.** `implement-bead`'s *Merging* section catches the branch up with main only after the
review and CI, as the last step before merging. When a geometry or layout spec fails in CI and passes
locally, catching up with main is worth trying **before** diagnosing the diff — it is one CI cycle
either way, and it is the cheapest way to rule out a stale base. A line to that effect in *Red CI*,
beside the flake-re-run cap, would have saved two of the three cycles here.

**Seen before.** ah-l2i.3, ah-2r3, ah-bwly.2 — the identical `strip.y` assertion, each time recorded
as a CI-only failure with the cause "not established". This is the fourth sighting, and the first
where the failure was reproducible rather than intermittent; that it went away on a branch update
rather than on a re-run is the new piece of evidence.
