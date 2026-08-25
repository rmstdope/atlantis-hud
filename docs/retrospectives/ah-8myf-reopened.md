# ah-8myf (reopened) — retrospective

- **Implementer:** Wolverine
- **Date:** 2026-08-25
- **PR:** #687

## Every test in the plan passed and the reported defect was untouched, because nothing exercised the reporter's own report

**What happened.** `ah-8myf` shipped as #684 with every test its plan named, green. The navigator
then loaded the very report `gh-679` was filed from and saw the original defect unchanged: the
fisherman aboard Frozen Tomb [194] was still told it cannot produce fish. The delivered code was
correct; nothing in it ever ran. `carried_away` asks `sailing_requirement` whether the structure is
a vessel, and for that fleet the answer was no — `+ Frozen Tomb [194] : Galley, 40 Galleons, 11
Galleys, 10 Balloons.` states no `Sailors:` line, so the question falls to ruleset arithmetic over
its hulls, and `parse_fleet_kind` knew only `Fleet, <count> <hull>` and a bare single hull. It read
the whole clause as one hull name, which matches no item.

The bead's tests all built their fleet from a `longship()` helper carrying `Sailors: 4/4` in its
description, so `sailing_requirement` answered from the stated field every time and the arithmetic
path — the one the reporter's fleet takes — was never entered.

**Why.** The plan's *Validation* section named the two commands to run and one human check, but its
test plan built every fixture by hand. The one place a real report would have been read is the
"human check" the implementer cannot perform. Two levels down from the code under test sat a parser
that could not read the reporter's own fleet, and no test in the bead touched it.

**Cost.** A whole bead: #684 built, reviewed, merged and verified-failed, then reopened at P0 and
rebuilt as #687. Roughly two full cycles plus the navigator's verification session. The second run
also cost one review round, correctly — Copilot found that my first fix counted the fleet's leading
class word as an extra hull.

**Prevent by.** Where a bead is filed from a named report, **one test in it should read that
report**. The fixtures crate already exposes them (`atlantis_hud_fixtures::G7_F95_T72`), and the
test that finally pinned finding 2 is four lines long. Concretely, for a plan whose *Context* names
a `gh-` issue and a fixture: its test plan should carry a row naming that fixture and the unit id
from the report, alongside the hand-built unit tests — the hand-built ones pin the logic, the
fixture one pins that the logic is reachable. Hand-built fixtures are chosen to make the code under
test run, which is exactly why they cannot show that it does not.

**Seen before.** `ah-8myf` — the first run of this bead, a different finding about the same plan.
`ah-jk9h` — the bead this one follows, whose suppression this replaced.
