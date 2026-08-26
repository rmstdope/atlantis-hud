# ah-97ij.1 — retrospective

- **Implementer:** Wolverine
- **Date:** 2026-08-26
- **PR:** #704

## The plan for the lookup tool itself asserted two unverified Atlantis facts, and both were wrong

**What happened.** This bead's own plan gives two illustrative examples of the CLI it specifies:
`pnpm run atlantis data catapult` is quoted as expecting "exit 1 and the 'This is an answer'
message" (i.e. the game has no catapult), and the Command surface section says
`atlantis data sword` "prints an index because it matches six distinct names across 20 entries."
Running the finished tool against the committed data page shows both are false: `catapult` is a
real item (`[CATP]`, weight 800, priced in the carpenter's `CATP` recipe that
`committed.test.ts` already pins), and `sword` matches **eight** distinct names across 20 entries —
three crafting skills (`create runesword`, `enchant swords`, `create flaming sword`) plus five
items — not six.

**Why.** Neither example was checked against the committed fixture before being written into the
plan. The entry-count math for `sword` (20 entries) was right, so whoever wrote it had looked at
*something*, but not closely enough to list the distinct names it actually spans.

**Cost.** Ten minutes, caught during the plan's own "Validation" exercise step, before any test was
built on the wrong assumption — the pinned exact-wording tests in the plan use `giv`/`give`, which
*is* correct, so nothing in the shipped test suite needed changing. Recorded in the PR body as a
deviation rather than silently fixed.

**Prevent by.** Nothing structural — this is exactly the failure class `ah-97ij` (this epic) is
built to close, and it happened one level up, in the tool's own plan, before the tool existed to
check it with. No action needed once `ah-97ij.1` merges: the next planner that reaches for an
Atlantis fact has `pnpm run atlantis data <term>` to check it with in the same minute they write
it. Flagging this mainly because the irony is worth a sentence in the historical record — it is the
"161 sightings" pattern (`ah-t2pn.4`) surfacing during the construction of its own fix.

**Seen before.** None found under this bead id; the underlying pattern (an unverified Atlantis fact
asserted as true) is `ah-t2pn.4`'s 161-sighting finding, not a single prior retrospective file.
