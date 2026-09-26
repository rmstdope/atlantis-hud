# ah-5znb — retrospective

- **Implementer:** Bishop
- **Date:** 2026-09-26
- **PR:** #1319

## A failed verification did not reproduce from the fixture it named

**What happened.** The failure note named the fixture (`ah-haki-grain-only.rep`), the unit (684) and
what the Silver popup said. Running the core on that fixture with its own orders template gave a
unit that was fed: `@entertain` earned 15 against 10 upkeep, and there was no finding and no
negative figure. The note's sentence could not appear. The bug showed only after I opened the
navigator's still-running verification game and saw that 684's saved orders were `STUDY ENTE`.

**Why.** The failure note records what was seen, but not the orders that were in the game when it
was seen. The verification script's step 1 did not ask for any orders to be changed, so how
`STUDY ENTE` got there is not established.

**Cost.** About twenty minutes of probing (two throwaway core tests and a browser look) before the
first real reproduction.

**Prevent by.** In `atlantis-verification` (and Psylocke's failed-verdict note), record the unit's
orders block as it stood when the failure was seen, alongside the fixture and the observed text.

**Seen before.** none found
