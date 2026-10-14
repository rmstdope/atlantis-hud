# ah-ayg7 — retrospective

- **Implementer:** Shadowcat
- **Date:** 2026-10-14
- **PR:** #1572

## Maintenance's relief in the ledger serves two readers that disagree about a refused order, and nothing says so

**What happened.** The fix the bead named took one line: carry `Lending::refused` into maintenance. It broke the hex warning, which counts a refused order as spending the silver (ah-9n7l.2). Step 4 then spent the same coins a second time on upkeep. The first repair added the upkeep back in the warning's reading. The cold-read review found two hexes where that came out wrong: one with no rich faction-mate, and one where the hand-back was lent to a mate's upkeep. The second repair ran steps 4 to 7 twice and left the ledgers holding the warning's settlement. The follow-up review then found that the SILVER column's month-end purse and the walking-sharer lending read the ledger after settlement too. Each read of a shared field turned out to belong to one side or the other, and nothing marked which.

**Why.** `upkeep_relieved`, `upkeep_lent` and `maintenance_pooled` are the one record of steps 4 to 7. Before this bead, the column and the warning agreed on them by coincidence: both counted the refused order as spent. Once the column has to show what the engine really does, the two need different settlements. The readers are spread from `forecast_hex` and `sharing_purse_over` to `report_shortfalls` and `lend_walking_sharers_silver`, and no doc on those fields names who reads them for which surface.

**Cost.** Two review rounds beyond the first and three fix pushes, about an hour and a half. Two more rebases came because ah-6y6e and ah-rbei rewrote `purse_carried` while the PR was open.

**Prevent by.** A doc paragraph on `Ledger::upkeep_relieved` (semantics.rs) that names its readers by surface: column (`forecast_hex`, `sharing_purse_over`, `lend_walking_sharers_silver` at Maintenance) or warning (`report_shortfalls` and below). It should point at `ReportWideSettlement::warning_relief` as the warning's copy. A test of a maintenance change should then pin one column figure and one warning sentence in a hex where nobody can pay the rest.

**Seen before.** ah-su1x (second section): a second reader of a balance that the first change had not reduced.
