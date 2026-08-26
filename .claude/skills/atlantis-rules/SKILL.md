---
name: atlantis-rules
description: Look up a fact about the Atlantis game — an order's syntax or effect, what a skill, item or structure does, the sequence of events in a turn, or any number the game defines — from the game's own rules and data pages rather than from memory. Use whenever a statement about how Atlantis behaves is about to be written down.
---

# Looking an Atlantis fact up instead of recalling it

Every role in this fleet reasons about Atlantis constantly, and a misremembered rule passes every
check the fleet runs, because the checks encode the same belief the plan does. `ah-9js` cost an
implementation, a ruleset regeneration and a round of test edits over exactly this. A lookup is
cheaper than being wrong, so use it — do not guess and do not trust what you remember about this
game.

## The two sources

- **The rules** — order syntax, what each order does, the sequence of events in a turn, movement,
  combat, economy. Committed at `tests/fixtures/ruleset/neworigins-rules.html`.
- **The data page** — items, skills, structures and their numbers. Committed at
  `tests/fixtures/ruleset/neworigins-data.html`.

Both are read from the **committed copy**, not fetched live — checked byte-for-byte against
`https://atlantis-pbem.com/rules` and `https://atlantis-pbem.com/data` when this skill was written.
A live fetch would put a network dependency inside an unattended session and produce no diff for
anyone to notice the game had changed; `atlantis check` and `atlantis refresh` below are the
deliberate, occasional way the copy is updated instead.

## Commands

Always the plain form — no `--` before the arguments. (This repository pins pnpm@9.12.0, which does
not strip a literal `--`; `atlantis` itself drops one leading `--` defensively, but never write one.)

| Command | Does |
|---|---|
| `pnpm run atlantis rules <anchor>` | The rendered section, under a provenance header |
| `pnpm run atlantis rules --list` | All anchor names, one per line |
| `pnpm run atlantis rules --search <term>` | Anchors whose text mentions the term |
| `pnpm run atlantis data <term>` | Full entries when the term names one thing; an index when it names several |
| `pnpm run atlantis data --list skills\|items\|objects` | One line per distinct name in that section |
| `pnpm run atlantis verify` | Compares `config/public/ruleset.json` to the committed data page |
| `pnpm run atlantis check` | Fetches both live pages, compares bytes to the committed copy |
| `pnpm run atlantis refresh` | Re-fetches, rewrites the committed pages and `config/public/ruleset.json` |
| `pnpm run atlantis` or `--help` | This table, in prose |

A lookup is cheap — milliseconds against a 280 KB file read once — so there is never a reason to
guess instead of running one. An anchor that does not exist prints its closest matches; a data term
that matches nothing says so plainly rather than staying silent. Both are answers, not failures:
`pnpm run atlantis data <nonsense>` exiting 1 with "the game has no such thing" is exactly as useful
as a successful lookup, and is not a reason to fall back on memory.

Every lookup prints a provenance header naming its source and the fact that it is a committed
snapshot, so a rule can be quoted and cited — e.g. `rules/give` or `data/SWOR` — rather than passed
off as something recalled.

## `verify`, and the data page as arbiter

`config/public/ruleset.json` is the file the application actually reads; it is generated from the
data page by a separate scraper (`@atlantis/ruleset`), and the two can drift if one is edited without
the other. `pnpm run atlantis verify` compares them field by field and names any disagreement. **The
data page is the arbiter** — if it disagrees with `ruleset.json`, the fix is
`pnpm run atlantis refresh`, never a hand edit of the JSON.

`verify` only compares what the scraper models: items, skills, buildings and movement numbers. It
says nothing about the rules page's prose, so a clean run is not a claim that every sentence in the
repository still matches the rules — only that the numbers do.

## Keeping the copy current

Noticing that the live site has changed and deciding what to do about it is a separate concern from
this skill, covered by `ah-97ij.2`. This skill's job stops at giving an accurate answer from
whatever is currently committed.
