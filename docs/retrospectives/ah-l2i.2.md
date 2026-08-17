# ah-l2i.2 — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-08-17
- **PR:** #386

## `diskPreflight.test.ts` failed mid-bead again — the sixth sighting, and this one was recoverable in-repo

**What happened.** `pnpm exec tsx scripts/diskPreflight.ts` passed at the start of the bead (10.5 GB
free against its 5 GB floor). The first `pnpm run check:fast` in the worktree then failed inside
`test:tooling` on `scripts/diskPreflight.test.ts`, with 7.7 GB free — below the 8 GB floor the
worktree's copy of the script enforces. `rm -rf target/debug/incremental` in the worktree freed
1.3 GB (9.4 GB free) and the gate passed on the next run, with no dependence on anything outside the
repository.

**Why.** Established, and the same mechanism ah-l2i.1 recorded: the opening preflight and the gate's
own test enforce **different floors** (5 GB vs 8 GB), so a run can start clean and fail a check that
has moved nothing. What differs from ah-l2i.1 is only the remedy — there the run had to wait for the
navigator to free space outside the repository; here `target/debug/incremental` was large enough on
its own, exactly as `implement-bead`'s *Traps* section says it usually is.

**Cost.** One wasted `check:fast` run and one re-run, about eight minutes.

**Prevent by.** Running the opening `scripts/diskPreflight.ts` against the **gate's** floor rather
than its own, so the check that stops a bead is the one that opens it. Failing that, the six sightings
below make a case for `check:fast` reclaiming `target/debug/incremental` itself before it reports a
disk failure — it rebuilds automatically and is the reclaim the instructions already name.

**Seen before.** ah-l2i.1 (which counted four sightings before it: ah-9r0, ah-9lv, ah-8m0.2, ah-quw,
ah-s0m are the files that mention it). This is the sixth.

## A sub-pixel map-transform smoke test failed in CI on a diff that touches no map code

**What happened.** `smoke (desktop-shell, 1, 2)` failed on
`tests/smoke/shortcuts.spec.ts:239` — "right-click centres the view on a hex, without selecting it" —
expecting `translate(945.09,-103.11) scale(0.5946)` and polling out on
`translate(945.09,-102.57) scale(0.5946)`: a **0.54 px** difference in `y`, after a 15 s poll. The
retry then failed the other way, on the earlier `not.toBe(before)` assertion. Nothing in this bead's
diff touches the map, the view transform or the shortcut handling. Run locally with
`pnpm run test:smoke -g "right-click centres the view on a hex"` the two tests passed in 8.1 s, and a
single `gh run rerun --failed` was green.

**Why.** Not established. The assertion compares a formatted transform string for exact equality, so
any sub-pixel difference in where the centring animation settles fails it; why the CI runner settled
0.54 px short once is not something I proved.

**Cost.** One local reproduction run and one CI re-run, about ten minutes.

**Prevent by.** Asserting the centred transform within a tolerance rather than by string equality
in `tests/smoke/shortcuts.spec.ts` (the spec already knows the expected numbers; comparing the parsed
`translate` components to within a pixel would pin the behaviour just as well and could not fail on a
rounding difference). That is a change to a spec outside this bead, so it is recorded rather than made.

**Seen before.** None found — no retrospective mentions this spec.
