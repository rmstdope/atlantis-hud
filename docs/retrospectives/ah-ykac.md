# ah-ykac — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-10-17
- **PR:** #1660

## The agreed mockup drew a cell the application does not draw

**What happened.** The mockup (`docs/ui/ah-ykac-units-filter-items.html`) drew Items cells as
`40 livestock [LIVE]`, with the name marked when "livestock" was typed. The real cell prints codes
only (`itemCellParts` → `40 LIVE`), and the acceptance says "nothing else in the cell changes". A match
on the item name alone therefore had no visible text to mark. The agreed experience did not settle
that case, and the build design had to stop and ask the navigator. The answer was to mark the whole
code.

**Why.** The mockup was drawn from an idea of the cell rather than from the cell's own output, and
nothing in the UX stage compares a mockup's sample rows with what the component renders for the
same data.

**Cost.** One navigator question during build design, a few minutes, and an answer that lives in
the plan rather than in the acceptance, where the verifier briefs from.

**Prevent by.** In `agree-experience`, when a mockup redraws an existing surface, take its sample
rows from the running application or from the component's formatter (here `itemCellParts`), and say
in the acceptance which existing formatting is kept as it is.

**Seen before.** Related to `ah-dlao`, where a plan and its mockup described editor content the code
does not hold. That one was found by a test; this one was found while reading the code during design.
