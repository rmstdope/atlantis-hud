# ah-5p8y — retrospective

- **Implementer:** Nightcrawler
- **Date:** 2026-10-13
- **PR:** #1524

## The bug as filed was correct behaviour in the very case it named

**What happened.** The bead said the preview dropped 4008's `GIVE 4840 14 IRON` in desert (41,35)
of `newage-arcanum-f5-t84.rep`, because 4008's ITEMS row showed only "given 14 by Unit (4686)".
I wrote a fixture test first. It reproduced a *different* silent drop, in a hex where nothing
shares. Only when I ran the real report through `preview_orders_for_remembered_report` did I see
that the preview was right. Every unit in that hex shares and 4686 holds 60 iron, so the engine's
`Game::DoGiveOrder` funds 4008's GIVE from 4686 (`Unit::GetSharedNum`/`ConsumeShared`, unit.cpp).
4840 receives 14 from 4008, and 4686's row carries the debit. 4008's own row never mentions its
GIVE, because the iron it passed on was never its own.

**Why.** A GIVE that a sharer funds is recorded on the lender's row (`GivenAway` to the
recipient), not on the giver's. Seen from the giver's row alone, that looks the same as a GIVE
that moved nothing. The bead's reading was natural, not careless.

**Cost.** About half an hour of investigation, plus a scope correction: the real defect (a cut
goods GIVE or TAKE got no warning on its line) was fixed, and the reported case was pinned as
correct in `crates/core/tests/a_give_funded_by_a_sharer_in_report_order.rs`.

**Prevent by.** In `skills/fix-bug` step 2, before writing a fixture test, run the reported
report and orders through the real entry point (`preview_orders_for_remembered_report` or
`check_turn` on the committed fixture) and confirm the wrong output there. When a bug names a hex
whose units share, check every sharer's row as well as the giver's.

**Seen before.** None found.
