# ah-1mpx.3 — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-08-28
- **PR:** #758

## A new field on `ReportUnit` broke the map export's round trip, and no plan section named it

**What happened.** The bead's plan is unusually thorough — six layers, twelve files, every one of
them cited by line — and it made the parser fill a new `ReportUnit.combat_spell`. The first
`pnpm run check:fast` after that went red in a file the plan never mentions:
`crates/core/tests/export_map.rs`' `every_region_of_a_real_report_survives_the_round_trip`, with
`region 1:26,52 changed in writing`. `export_map` writes a report-shaped file and reparses it, and
`crates/core/src/report/write.rs`' `unit_line` is a hand-maintained mirror of the unit parser: it
writes `Skills:` but knew nothing about the new section, so the field the parser filled was dropped
in the writing.

**Why.** `unit_line` and `parse_unit` are two independent statements of the same format with no
mechanical link between them. Nothing fails at compile time when one gains a field; only that one
integration test notices, and only for a fixture that happens to contain the field.

**Cost.** One fast-gate cycle and about fifteen minutes, plus one more RED/GREEN increment
(`writes_a_mage_s_combat_spell_so_a_reparse_reads_it_back`) that the plan had not budgeted for.
Cheap this time because the test exists; the alternative is data silently missing from every map
a player shares.

**Prevent by.** A plan that adds a field to `ReportUnit` should name
`crates/core/src/report/write.rs`' `unit_line` in its *Files to change* alongside `unit.rs` and
`model.rs` — those three are one unit, and the round-trip test in `crates/core/tests/export_map.rs`
is what proves it. Worth stating in `plan-bead`'s checklist for a parser change, or as a comment
above `unit_line` naming its opposite number, since the writer is where a reader would never think
to look.

**Seen before.** None found.

## A leftover preview server from my own interrupted run failed 130 tests of the next one

**What happened.** A full `pnpm run test:smoke` completed (345 passed). A second full run, started
after a Rust change, began normally and then failed test after test from roughly the 130th onward —
a wall of `×F` in the dot reporter that read exactly like a regression in the change I had just
made. Running one spec on its own then answered plainly:
`Error: http://127.0.0.1:4184 is already used, make sure that nothing is running on the port`.
`lsof -ti :4184 | xargs kill -9`, and the identical tree ran clean: 572 passed, 0 failed.

**Why.** Not established beyond the port being held. `CI=1` was exported for every run, which is the
documented mitigation for a reused preview server (`.cerebro/traps.md`, and `implement-bead`'s
own trap list) — so `CI=1` did **not** cover this case. What is different here is that the first
run's process tree was interrupted rather than allowed to exit, and its `vite preview` outlived it
holding the port.

**Cost.** About twenty minutes: one twelve-minute smoke run thrown away, plus the diagnosis and a
single-spec run to get an honest error message.

**Prevent by.** Before starting a smoke run that follows another one — especially one that was
interrupted — check the block is actually free rather than assuming `CI=1` settled it:
`lsof -ti :$SMOKE_PORT_BASE -ti :$((SMOKE_PORT_BASE + 1)) | xargs kill -9`. The port check that
`implement-bead`'s *Workspace* section asks for once at the start of a session is worth repeating
before each smoke run, not only before the first. And when a smoke run mass-fails, run one spec
alone before believing the diff: the dot reporter shows no reason, and the single-spec run names it
in one line.

**Seen before.** None found — the existing preview-server trap is about a server being *reused*
under `CI` unset, which is a different failure and has a different fix.
