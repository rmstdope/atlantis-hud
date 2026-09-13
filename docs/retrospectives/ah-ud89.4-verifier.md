# ah-ud89.4 — retrospective

- **Role:** verifier
- **Date:** 2026-09-09
- **PR:** #1145

## The navigator was handed a shell in which every unit had no people

**What happened.** Preparing a two-bead sitting (ah-ud89.4, ah-1x2h.2) I needed hex plain (36,44)
of `neworigins-3.0.0-g5-f21-t39.rep`, but nearly every own unit there is flagged `sharing`, which
would have let the market-purse defect filed the same hour (ah-3c2t) lend them $232,238 and swamp
both readings. So I made a fixture by deleting the word `sharing, ` from the 28 own unit lines in
that one hex block, changing nothing else. I proved it with a probe — 22 regions, 0 unreadable
lines, tax base and market lines correct — wrote the script, launched the shell and handed it over.
The navigator reported back: *"Lots of units have no men. Among those 9498."*

**Why.** The parser reads a report's line wrapping, so deleting text from inside a unit line
destroys it. Measured afterwards on the shipped parser, unit 9498:

| what was done to the line | items parsed |
|---|---|
| nothing — committed report | `GNOL 100, SWOR 170` |
| `sharing, ` → nine spaces, width kept | `GNOL 100, SWOR 170` |
| `sharing` → `holding`, same length | `GNOL 100, SWOR 170` |
| `sharing, ` deleted, then hand-rewrapped | `GNOL 100` — one item lost |
| `sharing, ` deleted, wrapping untouched | `[]` — every item lost |

`men` is derived from the items, so an emptied list gives zero men — and nothing complains: no
unreadable line, no unknown tag, no error. My probe could not have caught it, because it stopped at
`parse_report_full`; `men` is only an estimate until `classify_units` has run, so the probe was
reading a number that was meaningless either way. Re-run with classification, the difference is
immediate and obvious. Filed as **ah-l09a** — the silent failure mode is a defect in its own right,
independently of the fixture-making rule.

**Cost.** One wasted handoff and about twenty minutes of the navigator's evening, of which the worse
half was mine: I first argued *against* their diagnosis, reasoning from `cache.rs`'s "a ruleset that
cannot be used leaves the report exactly as parsed" that the ruleset had failed to load, and asked
them to run a discriminating test. They ran it — the committed report showed 100 men, mine showed 0 —
which settled it against me. The confident wrong diagnosis cost more than the bad fixture did.

**Prevent by.** Two changes, both in this PR.
1. `.claude/skills/atlantis-verification/SKILL.md`, step 3 of *The fixture*: edit reports by whole
   lines and whole blocks only; to neutralise something inside a line, overwrite it with spaces of
   the same length, and verify with an `awk` width check that every line kept its width.
2. The same file, step 2: the probe must call `classify_units` and assert on **men and items**,
   compared against the committed report the fixture came from. An empty `unreadable_lines` is not
   evidence of a healthy fixture.

The third lesson has no file to put it in: when the navigator reports a symptom and I have a theory
that contradicts them, the cheap discriminating test comes before the argument, not after it.

**Seen before.** None found for the wrapping. The "report parsed before the ruleset settled, every
unit an estimate" symptom is ah-6yj2, which is what my wrong diagnosis pattern-matched to.
