# New Age Arcanum report fixtures

Six complete real reports downloaded on 2026-09-11 with the navigator's authorization for factions
3 and 5. Source: `https://atlantis-newage.com/api/worlds/arcanum`, using
`GET /files/history/<turn>/report?format=txt` after faction authentication. The server advertised
turn 84 as current, ruleset version 1.2.0, and history turns 2 through 84 for both factions.

Only the selected turns were downloaded: the earliest available report and the latest two
consecutive reports for each faction. These provide small import cases, same-turn multi-faction
merges, turn-over-turn history, and mature New Age maps without importing the entire archive.

## Identity and versions

Names follow `newage-arcanum-f<faction>-t<server API turn>.rep`. Unlike the root Origins corpus,
the turn in the filename is the server's history endpoint identifier, **not** HUD's date-derived
turn number. Preserve both rather than changing the original report dates:

| API turn in filename | Printed report date | HUD date-derived turn | Printed game version | Engine |
|---|---|---|---|---|
| 2 | February, Year 1 | 1 | NewOrigins 8.1.0 | 5.2.5 beta |
| 83 | November, Year 7 | 82 | NewAge 1.2.0 (beta) | 5.2.11 beta |
| 84 | December, Year 7 | 83 | NewAge 1.2.0 (beta) | 5.2.11 beta |

The early reports really are branded NewOrigins despite coming from Arcanum's history endpoint.
They are import/history fixtures, not evidence for today's New Age mechanics. Faction 5 is named
Martiniks1 in turn 2 and Bog Brawlers in turns 83/84; its numeric identity is unchanged.

## Selection and observed coverage

Counts below were obtained by parsing the sanitized reports with the available browser-core WASM
parser and Arcanum catalogue at download time. They describe the fixture, not an assertion that
HUD correctly implements every mechanic mentioned in it.

| File | Regions | Own units | Battles | Intended use |
|---|---:|---:|---:|---|
| `newage-arcanum-f3-t2.rep` | 1 | 1 | 0 | Tiny Nexus/Gateway report, Treasury comment preamble, no orders envelope, movement error text |
| `newage-arcanum-f5-t2.rep` | 1 | 1 | 0 | Same-turn second faction, no orders envelope, faction-name history |
| `newage-arcanum-f3-t83.rep` | 247 | 951 | 16 | Large New Age map; lake, hill, grotto, deepforest and chasm regions; Canal, Caravanserai, Palace and Town Hall structure records |
| `newage-arcanum-f3-t84.rep` | 246 | 949 | 11 | Consecutive partner to f3/t83; changed map, units and battles; fleets and Shaft structures |
| `newage-arcanum-f5-t83.rep` | 175 | 732 | 6 | Second mature faction; Canal and Mystic Canal structure records, fleets, EXPLORE text |
| `newage-arcanum-f5-t84.rep` | 178 | 733 | 5 | Consecutive partner to f5/t83 and same-turn partner to f3/t84; changed map and units |

All six parsed with no unreadable lines in that probe. The mature reports also contain BWHI, RMAP
and BNTY tags, with TMAP in faction 5's reports, plus teaching/transport/quest-related text. A word
or tag occurrence alone does not prove that a specific unit can execute an order: locate the
relevant inventory, structure, relationship and route before using a report for that assertion.
There is no CPIR text in this selection, and no parsed `tunnels` region; use a focused fixture
where a test needs those cases.

## Using the fixtures

TypeScript: `NEWAGE_ARCANUM_REPORTS`, `readNewAgeArcanumReport("f5t84")` and
`newAgeArcanumReportPath("f5t84")` from `@atlantis/fixtures`.
`readNewAgeArcanumRuleset()` reads Arcanum's current catalogue, not the default Origins catalogue.

Rust: `NEWAGE_ARCANUM_F5_T84.text` (and the other faction/turn constants),
`ALL_NEWAGE_ARCANUM_REPORTS`, and `NEWAGE_ARCANUM_RULESET_JSON` from `atlantis-hud-fixtures`.

These opt-in groups deliberately do not extend `REPORTS` or `ALL`: existing corpus sweeps assume
New Origins. The fixture-package tests keep each language's registry in step with this directory.
The TypeScript guard also requires every report to be documented and scans every credential-bearing
line, not merely the first orders envelope.

Arcanum is not Trident. Load Arcanum's catalogue for the mature reports; do not relabel them as
Trident reports or use their outcomes as proof of Trident-specific rules. For example, Arcanum's
leader maintenance is 50 silver (`newage arcanum rules/economy_maintenance`), so these reports
cannot establish Trident's different leader-maintenance behavior. The current Arcanum catalogue
is not a historical catalogue for the turn-2 NewOrigins-branded reports.

## Sanitization

Passwords were replaced in memory before any report was written to disk. Every orders envelope
now reads `#atlantis <faction> "<password>"`; each of the four mature reports has one. The two
early reports have none. No other password-bearing lines were present. Authentication tokens and
unredacted downloads were not saved. Legitimate numeric unit IDs, amounts and coordinates were
preserved; they are not credentials simply because their digits match a password.

Apart from credential redaction, the reports retain their original content, including faction and
unit names, map information, orders, errors, battles and Treasury comments. They are not anonymous
or public-information-only samples; the navigator authorized their inclusion in the repository.
