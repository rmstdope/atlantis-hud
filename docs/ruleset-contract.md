# Ruleset contract (issue #8)

Movement costs, movement allowances and the item catalogue are **scraped from the game being
played**, not hard-coded. Atlantis servers generate both source pages per game, so a table written
into the source would silently disagree with whichever server the player is actually on.

## Where the numbers come from

Two engine-generated pages, complementary and both required:

| Page | Provides | Does **not** provide |
| --- | --- | --- |
| rules (e.g. `https://atlantis-pbem.com/rules`) | movement points per mode, terrain costs, the road rule, the ocean rule | item stats, monster stats |
| data (e.g. `https://atlantis-pbem.com/data`) | item weights, capacities, `moves N hexes per month`, monster combat stats | terrain costs, any Road entry |

Both are prose. The scraper anchors on the engine's own sentences and records, for every movement
value, the sentence it was read from.

## Running it

```
pnpm --filter @atlantis/ruleset scrape -- \
  --rules https://atlantis-pbem.com/rules \
  --data  https://atlantis-pbem.com/data
```

Writes `config/public/ruleset.json`. Either argument may be a local file instead of a URL; a relative path
resolves against the repository root. The script is run deliberately, never as part of a build, and
never in CI — `config/public/ruleset.json` is committed so that a fresh clone and CI need no network.

The script is named `scrape` rather than `fetch` because `pnpm fetch` is a builtin command that
would shadow it.

## Failure policy

**Movement values fail loudly.** If a required sentence does not match, the run aborts with a
non-zero exit naming the value, and `config/public/ruleset.json` is left untouched. There is deliberately
no fallback to a default: a movement number that is quietly wrong produces routes that are
confidently wrong, which is worse than no planner at all. The fix for a reworded page is to update
the pattern, never to invent a value.

**The item catalogue is tolerant**, in the same spirit as the report parser. One exotic entry
phrasing its attacks unusually should not cost us the other hundred and seventy.

## Shape of `config/public/ruleset.json`

- `source` — both URLs, the fetch timestamp, and how to regenerate.
- `movement` — `movementPoints`, `terrainCosts`, `road`, `ocean`, plus `provenance` giving the
  sentence behind each value. `ocean.terrain` is the name of the water terrain itself, read out of
  the rule's own sentence rather than assumed to be `ocean`, so the core never hardcodes a name
  that belongs to the game. This ruleset enumerates its terrain as *Ocean, Plain, Forest, Mountain,
  Swamp, Jungle, Desert, Tundra* and has no other water type.
- `risk` — **not scraped**, and says so on its face (`scraped: false`). These thresholds are ours
  to tune; nothing about them claims to mirror the server.
- `items` — keyed by tag, each with `kind` (`man` / `mount` / `monster` / `ship` / `equipment`),
  `weight`, four `capacity` values, `selfMobile` and `moves`; monsters additionally carry `combat`,
  ships a `cargoCapacity`, and a conditional capacity its `capacityCondition`.

### Two things that are easy to get wrong

**`capacity` and `selfMobile` are different questions.** Most entries state a number
(`walking capacity 20`), but thirteen state only the capability (`livestock [LIVE], weight 50, can
walk`, and the nine illusory creatures). The engine prints capacity *net of the item's own weight*,
so the bare form appears exactly when net capacity is zero — the item carries itself and nothing
more. Recording only the number made those items look immobile.

**A creature can be both a race and a mount.** A centaur's entry says `This race may study …` and
`This is a mount.`; the race marker wins, because the catalogue exists to tell men from equipment
and a unit of forty centaurs must not contribute nobody to a headcount. Centaurs appear in the
committed turn 71 report. For the same reason the ship test is not the literal `This is a ship`:
Balloon, Airship and Cloudship describe themselves as `a flying 'ship'`.

Ships state no weight of their own, so their `weight` is 0 in the sense of *not stated*.

## How it reaches the core

The shell fetches the JSON at startup and passes it to the Rust core, which validates it once. The
core therefore performs no file I/O and still compiles to wasm. Correcting a value means editing
the served file and reloading — no rebuild, which is the whole reason it is a config file.

`Ruleset::from_json` in `crates/core/src/movement/rules.rs` distinguishes two failures.
**Malformed** means the text is not a ruleset, and carries serde's own message, which names the
field it wanted. **Unusable** means it parsed but says something no route could be costed against:
a zero movement allowance, a zero terrain cost, a road divisor of zero, a water rule naming no
terrain, risk thresholds the wrong way round, or a catalogue with no races in it. Each of those is
well-formed JSON, which is exactly why serde alone is not enough.

Two things the core decides, both stated at their definitions:

- **Terrain the ruleset does not list costs the normal amount** rather than raising an error. The
  rules page says its list is not closed — *"there may be other types of terrain to be discovered
  as the game progresses"* — and the map renderer already knows `cavern`, `underforest` and
  `wasteland` that this game's fixture never shows.
- **Swimming has no allowance of its own**, so a swimming unit is costed at the walking rate. The
  rules page gives allowances for walking, riding and flying only; a unit's swim capacity decides
  whether water is passable, not how fast it crosses.

## Why the item catalogue matters beyond movement

It is the item reference the report parser has always lacked. Without it a unit line like
`50 leaders [LEAD], 20 nomads [NOMA], 30 swords [SWOR]` cannot be split into men and equipment,
because nothing in a report marks which tags are people — the caveat recorded at
`crates/core/src/report/model.rs`. It also supplies the monster combat stats the risk heuristic
weighs.

## What is deliberately not modelled

### Weather — a known gap that makes winter routes too cheap

This one is a genuine hole, not an absence. The rules page never states a weather rule with
numbers, but it does prove one exists:

> a unit on foot trying to move into a mountain region **in winter** would not have enough movement
> points to enter in one turn, but if it continues the same move on the next turn, it would use the
> accumulated points from the last month and manage to enter the mountains at last.

A walker has 2 movement points and a mountain costs 2, so 2 is exactly enough — which means winter
must push a mountain to **at least 3**. The page gives no multiplier, no list of affected terrain,
and no way to tell which months are winter in a given world; turn reports carry no weather line
either. So there is nothing to scrape and nothing to infer.

The consequence, stated plainly: **a route planned across a winter month is under-costed**, and
under-costing is the failure direction that matters, because it makes a journey look achievable
when it is not.

**Decision (navigator, issue #8): the planner costs routes without weather and says nothing about
it in the interface.** The gap is recorded rather than surfaced. `config/public/ruleset.json` carries it
in a `gaps` block, `Ruleset::is_fully_modelled()` reports it, and this document explains it — so
the file never claims more than it knows, and whoever picks the question up later has the evidence
to hand. Revisiting it means either supplying the winter numbers by hand, marked `scraped: false`
the way the risk thresholds are, or showing the total as a lower bound.

### Sailing

Fleet movement is a second rule system — fleets have their own speed and pay a flat one point for
any region, coastal forest included — and #8 plans land movement only. `MovementMode` therefore has
no `Sail`.

### Swimming speed

`MovementMode` has no `Swim` either. The page names exactly three modes of travel — *"walking,
riding and flying"* — and gives swimming no allowance, so any swim speed would be invented. A
unit's swim capacity still matters, but as a legality question rather than a speed one, and this
ruleset's water rule exempts only flight from needing a ship.

## Evidence that the catalogue is read correctly

Every unit in a turn report carries `Weight:` and `Capacity: fly/ride/walk/swim` as the *server*
computed them. `packages/ruleset/src/capacity.test.ts` reproduces those numbers from the scraped
weights and capacities for three units quoted from the turn 71 report, including one whose weight
exceeds all four of its capacities and therefore cannot move at all. Nothing we wrote produced the
server's figures, so agreement is independent evidence rather than a restatement of our own logic.

The oracle does not cover everything. No unit in either committed report carries a bare `can walk`
item alongside a `Capacity:` line, so the `selfMobile` rule above is a derivation rather than a
measurement, and its test says so on its face.

## Why there is no worker

Issue #8 lists a "worker/thread execution path for heavy computation" as a deliverable, and the
implementation plan chose to move the whole core into a Web Worker. That was built, measured, and
removed. The measurements, loading the committed turn 71 report:

| | Wall time | Longest main-thread block |
| --- | --- | --- |
| Core called directly | ~150 ms | **70 ms** |
| Core behind a Web Worker | ~850 ms | **755 ms** |

The worker made the same load about five times slower and blocked the page ten times longer. The
cause is the boundary rather than the worker: parsing four thousand lines takes under a tenth of a
second, but the model it produces — eleven regions and some four hundred and fifty units, each with
items and skills — has to be structured-cloned back, and deserializing that on the page costs far
more than the parse ever did.

The premise for choosing a worker was that report parsing was a source of jank. It is not, and was
not: seventy milliseconds, once, when a file is opened. The route planner is smaller still — the
search covers 57 known hexes and completes in microseconds.

So #8's interactivity requirement is met by evidence instead of by architecture, and
`tests/smoke/workspace.spec.ts` carries the regression guard: it samples how long the main thread
goes unresponsive during a report load and fails if anything stops the page for whole seconds.

What did turn out to cost is below, and it was none of these things.

### The cost was repetition, not parsing (issue #28)

Two later measurements said the same thing twice. **Remembering a turn cost more than parsing it**,
and **planning re-parsed the whole report on every gesture.** Both had one cause: the same four
thousand lines were parsed three times per import and once more for every route, because every
entry point took the report as text and the text was thrown away after each call.

`plan_route` was the worse of the two, because it happened on a user gesture rather than on a file
open: arming the planner and picking a hex re-parsed the report and re-classified every unit before
the search ran. The search itself is microseconds over 57 hexes. Committing the import was the
larger figure, because on top of a third parse it asked for the whole parsed model back across the
wasm boundary purely to serialize eleven regions into the sightings store — the same boundary cost
the worker experiment measured, paid on the way out instead of the way in.

The fix is not to parse faster or elsewhere. It is to parse once and keep the result:
`crates/core/src/cache.rs` remembers the last report parsed, the last one classified, and the last
ruleset read, each keyed on the exact text it was built from. The calls stay as stateless as they
ever were — there is no session to open and none to invalidate, because a new turn is simply a
different key — and the file-open parse is the one the planner then searches over, so the freeze
does not happen once, it does not happen. Alongside it, `prepare_report_import_state` now returns
the region rows already serialized, so nothing large crosses the boundary on import at all.

Measured on the committed turn 71 report, warmed, on one machine so the two columns compare:

| Longest main-thread block | Before (main at `6f49277`) | After |
| --- | --- | --- |
| Report load | 1204 / 1945 / 1525 ms | **429 / 272 / 262 ms** |
| Route plan | 1391 / 397 / 664 ms | **153 / 172 / 182 ms** |

Three runs each rather than one, because the figures are noisy: the spread within a column is
wider than some of the differences this document used to record. Treat any single number here as
indicative and the ratio as the finding.

Those absolute figures are also higher than the 345–515 ms and 674–919 ms recorded above them,
which were taken on different hardware and before the game concept landed. That is exactly why the
guards in `tests/smoke/workspace.spec.ts` are calibrated against a CI run rather than a local one,
and why both now print the block they measured: the number this project cares about is the one the
slowest machine sees, and it should be readable from a log rather than guessed at.

This is worth revisiting if either number changes — a map accumulated over many turns, or a planner
that searches thousands of hexes. The shape to reach for then is still not "put the core in a
worker" but "stop moving the large model across the boundary": keep the model core-side and pass
only what a panel needs.
