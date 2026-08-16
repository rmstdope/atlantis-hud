# Order checks vs. the report corpus

## What this is

The 25 turn reports committed under `tests/fixtures/reports/` each carry an `Errors during turn:`
section — the engine's own record of what it refused. `crates/core/tests/corpus_errors.rs` parses
every one through `parse_report_full(text).header.errors` (the same path `parse_real_reports.rs`
uses) and renders every distinct message, normalised (unit prefix stripped, numbers replaced with
`N`) and counted, to `corpus-errors.generated.md` beside this file. This document is the judgement
that table cannot carry on its own: for each message, whether an order check could have caught it
before the turn ran, and if so, which bead now tracks building it.

Two caveats the counts do not show on their own:

- **One ruleset.** All 25 reports are `neworigins-3.0.0`. A message that never appears here may
  still be common under a different ruleset, and one that appears often here may be an artefact of
  this ruleset's particular costs and limits.
- **Not independent samples.** Several turns belong to the same games (`g3` ×5, `g5` ×5, `g7` ×10,
  `g8` ×3) — several of them consecutive turns of the same faction. A message that recurs across a
  game's own turns is one player's habit repeating, not five players making the same mistake. The
  occurrence count ranks *how often it bit these players*, not how common the mistake is in general.

## The classification

| Order | Message | Occurrences | Group | Reason | Covered by |
|---|---|---:|---|---|---|
| STUDY | Maximum level for skill reached. | 11 | Catchable from the orders and the report | The ruleset carries each skill's `maxLevel` (`crates/core/src/movement/rules.rs` `SkillEntry`); the unit's current level for that skill is in the report. | ah-1uj |
| STUDY | Not enough funds. | 7 | Catchable from the orders and the report | `orders::semantics::study` already prices the month against the unit's silver and charges it. | not-enough-silver |
| GIVE | Nonexistant target (N). | 5 | Catchable from the orders and the report | The target id named by a `GIVE`/`TAKE` order either is or is not among the units the report shows in that hex; nothing else is needed to tell. | ah-djq |
| PRODUCE | Faction can't produce in that many regions. | 5 | Catchable from the orders and the report | The `Faction Status:` block prints `Trade Regions: used (max)` before the turn is submitted; the number of distinct hexes carrying a `PRODUCE` order is countable from the orders themselves. | ah-8om |
| Warning | Magic study rate outside of a building cut in half above level N. | 5 | Catchable from the orders and the report | The threshold (level 2) is a fixed game rule, not per-faction; the unit's magic skill level and whether its hex holds a building it is in are both in the report. | ah-a2k |
| - | N starve to death. | 3 | Not catchable | Starvation is resolved from the food balance of every unit sharing the region, including other factions' units the player cannot see, and the entertainment/tax choices the engine applies last. Nothing in the player's own report or orders pins the outcome. | — |
| BUY | Can't buy that. | 3 | Catchable from the orders and the report | The region's `for_sale` market listing is printed in the report; an order naming an item not on that list can be flagged before submission. | ah-d8u |
| TRANSPORT | Target does not own a transport structure. | 3 | Not catchable | Whether the *target's* structure has transport capability is a fact about a unit the player does not necessarily control or see the structure of — the player's own report shows their own structures, not the target's. Chosen conservatively per the investigation's tie-break rule. | — |
| DECLARE | Can't declare towards your own faction. | 2 | Catchable from the orders and the report | The faction's own id is in the report header; a `DECLARE` order naming it is a direct match, nothing else needed. | ah-8r2 |
| MOVE | Unit is overloaded and cannot move. | 2 | Catchable from the orders and the report | Unit weight and capacity are printed in the report (`Weight: N. Capacity: a/b/c/d.`) and already read for movement planning (`crates/core/src/movement/{rules,plan,trace}.rs`). Distinct from the fleet-sailing case in ah-j0e, which is about a ship's capacity and crew, not a single unit's own load. | ah-yfo |
| ATTACK | Non-existent unit. | 1 | Not catchable | The target may have left the hex, died, or never been visible to this faction between the last report and this turn's orders being written; the player's own report cannot rule that out. Chosen conservatively. | — |
| BUILD | Object is finished. | 1 | Catchable from the orders and the report | A structure's completion is printed in the report (a finished object needs no further `BUILD`); a `BUILD` order naming an already-finished object of the unit's own is a direct match. Filed at low priority given a single occurrence. | ah-90w |
| BUY | Unit attempted to buy more than it could afford. | 1 | Catchable from the orders and the report | `orders::semantics::buy` already charges the purchase price in silver and would flag the shortfall. | not-enough-silver |
| STUDY | Can't have another quartermaster. | 1 | Catchable from the orders and the report | The `Faction Status:` block prints `Quartermasters: used (max)`; a `STUDY` order for the quartermaster skill when the faction is already at its maximum is a direct match. Shares its data source (`Faction Status:`) with ah-8om, but is filed separately since it checks a different order. | ah-oq3 |
| STUDY | Can't study that. | 1 | Catchable only with rules the client lacks | The unit (a mage, seen casting successfully elsewhere in the same turn) was refused a skill the ruleset's own catalogue does very likely know by name, which suggests a magic-specific eligibility rule (a prerequisite skill, or a per-mage limit on foreign skills) that the ruleset's `SkillEntry` does not carry a field for. Source: the rules text at https://atlantis-pbem.com/rules, unread for this investigation — or "unknown" until someone does. | — |
| TEACH | Drones/Micaksica/zzZ (N) is not studying a skill you can teach. | 3 (1 each) | Catchable from the orders and the report | Already built. | taught-not-studying |

The generated table lists the three `TEACH: … is not studying a skill you can teach.` rows
separately — the unit's own name (`Drones`, `Micaksica`, `zzZ`) is part of the message, not the
stripped prefix, so `normalise()` correctly treats each as its own key, 1 occurrence apiece. This
document merges them into one row above since they share a reason and a `Covered by`.

## What was filed

Nine beads, all P4, all `relates-to` ah-v25:

- **ah-1uj** — Warn when a STUDY order targets a skill already at its maximum level (11 occurrences, 3 turns, 3 games)
- **ah-djq** — Warn when a GIVE or TAKE order names a unit not visible in the report (5 occurrences, 2 turns, 1 game)
- **ah-8om** — Warn when PRODUCE orders would exceed the faction's Trade Regions allowance (5 occurrences, 3 turns, 2 games)
- **ah-a2k** — Warn when a unit above level 2 studies magic outside a building (5 occurrences, 2 turns, 2 games)
- **ah-d8u** — Warn when a BUY order names an item the region's market does not sell (3 occurrences, 2 turns, 1 game)
- **ah-8r2** — Warn when a DECLARE order names the unit's own faction (2 occurrences, 2 turns, 1 game)
- **ah-yfo** — Warn when a MOVE order would overload the unit issuing it (2 occurrences, 1 turn, 1 game)
- **ah-90w** — Warn when a BUILD order names an object that is already finished (1 occurrence, 1 turn, 1 game)
- **ah-oq3** — Warn when a STUDY order for the quartermaster skill would exceed the faction's allowance (1 occurrence, 1 turn, 1 game)

## Checks nobody needed

Whether each existing advisory code's engine error appears anywhere in the corpus:

| Code | Appears in the corpus? |
|---|---|
| `not-enough-silver` | Yes — "STUDY: Not enough funds." (7) and "BUY: Unit attempted to buy more than it could afford." (1) |
| `not-enough-items` | No matching engine error observed. The engine may simply cap a GIVE at what is held rather than refusing it, which would make this check catch something the engine itself never complains about. |
| `guard-dropped` | No matching engine error — this is inferred from state changes between reports, not something the engine refuses. |
| `hex-unguarded` | Same as `guard-dropped`. |
| `taught-not-here` | No matching engine error observed in this corpus. |
| `taught-not-studying` | Yes — "TEACH: X (N) is not studying a skill you can teach." (3, one occurrence each) |
| `teacher-cannot-teach` | No matching engine error observed in this corpus. |
| `teaching-oversubscribed` | No matching engine error observed in this corpus. |
| `teacher-has-free-slots` | No matching engine error observed in this corpus — an advisory, not a rejection, so this is expected regardless. |

None of these is a proposal to remove a check: several (`guard-dropped`, `hex-unguarded`,
`teacher-has-free-slots`) are advisories about conditions the engine never reports as an error, by
design, so their absence here says nothing about whether they are worth having.

## Already solved

Evidence the existing checks work:

- **`not-enough-silver`** already prevents the two silver-shortfall messages above from surprising a
  player: "STUDY: Not enough funds." (7 occurrences) and "BUY: Unit attempted to buy more than it
  could afford." (1 occurrence) are both cases `orders::semantics::study`/`buy` already charge
  against the unit's balance and `report_shortfalls` already warns about.
- **`taught-not-studying`** already catches every "TEACH: X (N) is not studying a skill you can
  teach." case in the corpus (3 occurrences, one per turn).
