# ah-6la1

- **Implementer:** Bishop
- **Date:** 2026-10-17
- **PR:** #1655

## The bug as filed was not a bug: its seller could draw on a sharing faction-mate

**What happened.** The bead, filed from exploratory testing, said the game cuts the Transporter's SELL 50 LIVE to the 36 it holds, and that the app showed it selling 8-10 too many. In the fixture (neworigins-3.0.0-g3-f42-t42, Aportheo), though, Farmers (3493) carries the `sharing` flag. Unit::GetSharedNum (unit.cpp) counts every sharing faction-mate's stock, so the game never cuts the order: it sells about 35, and the app's 34 is only ah-alwr's rounding. Recomputing from the engine source showed this before any test was written. The navigator then retargeted the bead to the real divergence the investigation turned up: in a hex with no sharing, Game::DoSell divides by the ordered amounts and not by the holdings.

**Why.** The filing worked out the engine's cut against the seller's own holding and did not check the hex's units for the SHARE flag, which GetSharedNum depends on.

**Cost.** One navigator question and a bead rewritten in place. The real fix was still found, because the recomputation was done before the test.

**Prevent by.** In the bugfixer's step 1 (`skills/fix-bug` *The bug-fix contract*), when a bug claim involves a quantity the engine reads through GetSharedNum or ConsumeShared (SELL, GIVE, BUILD, PRODUCE materials, silver), check the fixture's hex for `sharing` units before choosing the test.

**Seen before.** Not as a filing error. ah-0mch introduced the GetSharedNum reading this bead relied on.
