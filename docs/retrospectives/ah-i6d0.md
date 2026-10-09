# ah-i6d0 — retrospective

- **Implementer:** Bishop
- **Date:** 2026-10-09
- **PR:** #1479

## Six review rounds, each finding a new "who draws first" case at a fleet's landing site

**What happened.** The bug fix moved a sailing passenger's BUILD to the region its fleet lands in
and lent it the sharers there. The cold-read review and five delta reviews each found another
contention case that the fix priced as certain: a sharer's primary output, two building
shipmates, a third builder below them, a sharer on another hex's fleet, a resident builder, two
fleets beside a resident sharer, a resident manufacturer, an arriving manufacturer. Rounds two and
three each tried to *model* the order (report order within a fleet, residents first), and each
model opened two new cases. It converged only once the order was declared unsettled and a single
conservative rule (`AwaySite::contested`: two or more units building or manufacturing at the
landing plus anything shared there, so every such build and manufacture is uncounted) replaced
the modelling.

**Why.** The report does not say in which order the engine walks units it has just carried into a
region, yet the existing cross-hex lending (`lend_to_month_end_hexes`, `ah-7r9p`) silently assumes
one: an arrival lends what its own month-long orders left. Every attempt to price a passenger's
build at the landing inherited that assumption somewhere.

**Cost.** Six reviewer sub-agent runs (one lost to an expired login), six fast-gate runs and about
two hours of wall-clock beyond the first green PR; two follow-up beads (ah-lz1g, ah-jda3).

**Prevent by.** `skills/fix-bug` step 4 ("the smallest coherent change"): when a fix makes a
unit's month-long order run in another hex's pool, decide in the reproduction step whether the
order of units in that pool is settled by the report, and if it is not, write the conservative
"uncounted when contended" rule and its test first instead of modelling an order.

**Seen before.** none found.
