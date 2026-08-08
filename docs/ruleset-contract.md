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

Writes `config/ruleset.json`. Either argument may be a local file instead of a URL; a relative path
resolves against the repository root. The script is run deliberately, never as part of a build, and
never in CI — `config/ruleset.json` is committed so that a fresh clone and CI need no network.

The script is named `scrape` rather than `fetch` because `pnpm fetch` is a builtin command that
would shadow it.

## Failure policy

**Movement values fail loudly.** If a required sentence does not match, the run aborts with a
non-zero exit naming the value, and `config/ruleset.json` is left untouched. There is deliberately
no fallback to a default: a movement number that is quietly wrong produces routes that are
confidently wrong, which is worse than no planner at all. The fix for a reworded page is to update
the pattern, never to invent a value.

**The item catalogue is tolerant**, in the same spirit as the report parser. One exotic entry
phrasing its attacks unusually should not cost us the other hundred and seventy.

## Shape of `config/ruleset.json`

- `source` — both URLs, the fetch timestamp, and how to regenerate.
- `movement` — `movementPoints`, `terrainCosts`, `road`, `ocean`, plus `provenance` giving the
  sentence behind each value.
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

## Why the item catalogue matters beyond movement

It is the item reference the report parser has always lacked. Without it a unit line like
`50 leaders [LEAD], 20 nomads [NOMA], 30 swords [SWOR]` cannot be split into men and equipment,
because nothing in a report marks which tags are people — the caveat recorded at
`crates/core/src/report/model.rs`. It also supplies the monster combat stats the risk heuristic
weighs.

## What is deliberately not modelled

- **Weather.** This ruleset's page states no weather effect on movement — winter appears only in a
  passing example — and turn reports carry no weather line. There is nothing to scrape.
- **Sailing.** Fleet movement is a second rule system; #8 plans land movement only.

## Evidence that the catalogue is read correctly

Every unit in a turn report carries `Weight:` and `Capacity: fly/ride/walk/swim` as the *server*
computed them. `packages/ruleset/src/capacity.test.ts` reproduces those numbers from the scraped
weights and capacities for three units quoted from the turn 71 report, including one whose weight
exceeds all four of its capacities and therefore cannot move at all. Nothing we wrote produced the
server's figures, so agreement is independent evidence rather than a restatement of our own logic.

The oracle does not cover everything. No unit in either committed report carries a bare `can walk`
item alongside a `Capacity:` line, so the `selfMobile` rule above is a derivation rather than a
measurement, and its test says so on its face.
