# ah-c2jte — retrospective

- **Implementer:** Bishop
- **Date:** 2026-11-09
- **PR:** #1920

## An engine comparison against the usual checkout missed an item that master carries

**What happened.** To find every item the game will not ship, I compared the flags in `../Atlantis gamedata.cpp` with `Ruleset::can_be_transported`. The checkout is on `neworigins-rules-fixes`, which has no imprisoned entity, so `IENT` showed as "not in engine". I wrote on the bead that the engine had no `IENT` to check against. The cold review found it in `git show master:gamedata.cpp`, flagged `NOTRANSPORT | CANTGIVE`, and enabled by `master:neworigins/extra.cpp`.

**Why.** The two branches have diverged: the checkout holds the rules fixes, and `master` holds items the checkout lacks.

**Cost.** One review finding, one question to the navigator, and a second gate and CI run.

**Prevent by.** In `.claude/skills/atlantis-rules/SKILL.md`, add that a claim that the engine lacks something must be checked with `git -C ../Atlantis grep <term> master` as well as in the checkout.

**Seen before.** none found
