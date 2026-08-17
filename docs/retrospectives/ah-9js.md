# ah-9js — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-08-17
- **PR:** #401

## The plan's parser rule and the plan's expected result disagreed, and only the Rust suite said so

**What happened.** The plan specified pass one as "for each paragraph opening `X: This is a
building.`", and separately said to expect the buildings map to grow "to ten entries". Implemented
literally, the rule produces 58 entries: the data page calls a Mine, a road and every monster lair a
building. Nothing in the TypeScript suite objected — the parser tests I wrote from the plan all
passed. Two pre-existing Rust tests
(`a_structure_the_table_does_not_name_is_unknown_not_zero`, `a_buildings_mage_capacity_is_known`)
failed, which is what surfaced that the broad reading silently changed `mage_capacity("Mine")` from
`None` to `Some(0)` — a change to ah-a2k.2's warning that this bead's own *Out of scope* forbids.
The reading that satisfies everything else the plan promises is "an entry that states
`provides defense to the first N men inside it`", i.e. a fortification, which yields exactly the
plan's ten.

**Why.** The plan's parser rule was written from the object-entry shape, and its expected result
from a hand-made table of ten structures; neither was checked against the other. The two only
conflict on entries that are buildings but not fortifications, which the plan's table never lists.
**Cost.** About twenty minutes: one wrong implementation, one regeneration of
`config/public/ruleset.json`, one round of test edits.
**Prevent by.** When a plan states both a parser rule and an expected entry count, run the rule
against the fixture and compare the count *before* writing the tests — `parseX(FIXTURE)` in a
throwaway script is a minute's work, and it is what turns a plan contradiction into a decision
taken up front rather than one discovered by an unrelated suite three increments later.
**Seen before.** ah-a2k.2 ("the committed corpus contradicted the plan"), ah-1uj ("the plan's own
validation grep contradicted the prose the plan asked for") — the same class: a plan whose two
halves were each written correctly and never reconciled.

## `shortcuts.spec.ts` "right-click centres the view on a hex" failed in CI again — the fifth sighting

**What happened.** `smoke (desktop-shell, 1, 2)` failed on that spec on a diff that touches only
the ruleset scraper, the Rust `BuildingEntry` shape and `config/public/ruleset.json` — no shell
code, no map code. The spec passed locally first try
(`pnpm exec playwright test --project=desktop-shell -g "right-click centres the view on a hex"`),
and the job passed on re-run with no change pushed.
**Why.** Not established here. Four earlier retrospectives record the same spec or its neighbour
failing the same way.
**Cost.** One local reproduction and one job re-run, about fifteen minutes — most of it waiting.
**Prevent by.** This is now a standing cost, not a surprise: five beads have each paid a
reproduce-and-re-run cycle for it. The fix belongs in the spec (or in whatever makes the desktop
shell's right-click timing racy), and it is the navigator's to schedule — a bead of its own, which
no implementer can file from inside a planned one.
**Seen before.** ah-vfq, ah-do8.3, ah-l2i.2, ah-k6i.6 — all the same spec.

## `pnpm run test:smoke -- --project=desktop-shell` hung, exactly as the skill warns

**What happened.** Reaching for the documented-as-wrong form cost a 120-second tool timeout and a
stray background Playwright run that had to be killed. `pnpm exec playwright test --project=...`
is the form that works.
**Why.** The `--` is forwarded to Playwright as a positional filter; it matches no spec after
building and serving, which looks exactly like a hang. This is written down in `implement-bead`'s
*Traps* section, and I ran it anyway.
**Cost.** Three minutes and one orphaned process.
**Prevent by.** Nothing new — the trap is already documented. Recorded only because the *shape* of
the mistake is worth noting: the trap list is read at the start of a bead and needed in the middle
of one, an hour later, under a red CI job. Re-reading it before any local smoke invocation is the
cheap habit.
**Seen before.** none found.
