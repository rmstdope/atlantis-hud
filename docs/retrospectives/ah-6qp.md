# ah-6qp — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-08-17
- **PR:** #412

## The plan measured the page's grammar and got it wrong, and I coded the measurement rather than the page

**What happened.** The plan stated, as a measured fact, that the data page's requirement sentence has
exactly two forms — one requirement, or two joined by ` and ` — with "no comma form and no
three-requirement form", and even said that splitting on anything else would be "inventing a grammar
the page does not use". I wrote the split on ` and `, and repeated the claim in a code comment. The
page has two three-requirement sentences punctuated `a, b and c` (`ENGR` and one other), so the split
silently dropped the middle requirement of each. The Copilot review found it, named the fixture line,
and pointed out that the regenerated `config/public/ruleset.json` was wrong too.

**Why.** Established. The plan's own counting (66 statements, 32 with one requirement, 34 with two)
is consistent with a ` and ` count rather than a requirement count — a `a, b and c` sentence has one
` and ` in it and lands in the "two" bucket. My own check while building reproduced the same number
the same way, which read as confirmation rather than as the same mistake twice. The fix reads all
`[TAG] level` pairs out of the sentence instead, which needs no separator grammar at all.

**Cost.** One review round and one extra CI cycle, roughly 20 minutes.

**Prevent by.** When a plan states a count over a fixture, count the *thing* rather than the
separator the plan chose — here, `re.findall(r'\[[A-Z]{2,6}\] \d', sentence)` per sentence would have
shown three-element sentences immediately. More generally: a parser over a fixture should be
separator-free wherever the payload is self-delimiting (`[TAG] n` is), because that makes the
grammar claim unnecessary rather than merely checked.

**Seen before.** none found for the grammar itself. ah-3ej (same file, previous bead) is the same
shape one level up: a plan that stated something confidently about a source it had read, and an
implementer who built the statement rather than re-checking the source.

## A smoke test's premise was a behaviour this bead deliberately changed

**What happened.** `tests/smoke/completion-popup.spec.ts` opens `STUDY ` to get a completion popup
wider than the orders pane, because a popup that does not overhang has nothing to clip. Narrowing
`STUDY` to the skills the selected unit can begin made that list short — the fixture's unit is no
mage — and both walks went red in CI (`smoke (web, 1, 2)` and `smoke (desktop-shell, 1, 2)`) on
`popupBox.width > editorBox.width`, 289 against 314. Switching the helper to `CAST `, whose list no
unit narrows, restored the premise without weakening the assertion.

**Why.** Established. The spec's own comment says it opens "the skills list — the longest entries the
popup ever shows"; that was true when written and this bead is what made it false. Neither the plan's
*Validation* nor its *Out of scope* mentions the smoke suite, and `check:fast` does not run it, so
CI was the first place it could show.

**Cost.** One CI cycle plus a local reproduction, roughly 25 minutes.

**Prevent by.** A plan that changes what a completion list *contains* should name the smoke specs
that depend on a list being long — `grep -rl "STUDY \|cm-tooltip-autocomplete" tests/smoke/` finds
them in seconds — and either say they are expected to need updating or say why not. Adding it to the
plan's *Known traps* is enough; the fix itself is two lines.

**Seen before.** none found.
