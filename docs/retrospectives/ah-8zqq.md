# ah-8zqq — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-10-12
- **PR:** #1513

## A hand-written report fixture passed every check test without a single unit aboard the fleet

**What happened.** `crates/core/tests/a_fleet_refused_at_its_first_step.rs` holds a report as a
Rust string literal, one source line per report line, joined with `\` continuations. Five
`review_turn` assertions ("no `guard-dropped`", "no `produce-not-here`", …) passed at once, while
the preview assertion failed with the captain `Departing`. A parse probe
(`parse_report_full(REPORT)`, printing each unit's `structure_id`) showed every unit with
`structure_id: None`. Two faults in the fixture caused it: own units written with `-` (foreign)
instead of `*`, and `\` continuations in front of `  * Captain …` lines.
**Why.** In a Rust string literal, a `\` at the end of a line also swallows the *leading whitespace
of the next line*. So `\` followed by a newline and `  * Captain` reads as `* Captain` at column
zero, and the parser takes that unit as standing in the hex, not aboard the structure. The
"absent finding" assertions passed because nobody sailed, not because the code was right. What
exposed it was a control test: the same fleet sailing to sea, where every finding must fire.
**Cost.** About 20 minutes of probing a "preview bug" that was the fixture, plus a near miss: five
green tests that proved nothing.
**Prevent by.** For any test that asserts a finding's *absence*, add a control in the same file
where only the fact under test changes and the finding must be *present*
(`the_same_fleet_sailing_to_sea_carries_everybody_away` here). And in fixture literals, write
indentation that must survive a `\` continuation as `\x20\x20`, or end the previous line with
`\n` and no `\`.
**Seen before.** ah-lyg6.1.1 (a column-zero `- ` filter missing an indented unit inside a
structure: the same indentation-as-structure meaning, from the reading side). None for the `\`
continuation itself.
