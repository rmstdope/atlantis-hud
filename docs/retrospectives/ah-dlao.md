# ah-dlao — retrospective

- **Implementer:** Wolverine
- **Date:** 2026-08-19
- **PR:** #463

## The plan's stated trap was not real, and the test written against it could not go red

**What happened.** The plan (and the mockup behind it) said a no-columns finding selects the whole
`unit 4117` block header, so the next keystroke replaces it. The editor's document is one unit's
orders *without* the header line (`OrdersPanel.tsx:98` → `readUnitOrders`), and the units the plan
named as examples — 14451 and 13432, which have no orders at all — have an empty document. On an
empty document "select the widened line" and "put the cursor at the end" are the same position, so
the first smoke test written straight from the plan passed against the unfixed editor.
**Why.** The plan reasoned from `orderLint.ts`'s line-widening without checking what the editor's
document actually contains. The real discriminating case is a unit whose orders exist but spend no
month — `AVOID 1` — which is what the merged test uses.
**Cost.** About 40 minutes, and two smoke runs, before the reverted-fix check showed the test was
green either way.
**Prevent by.** When a plan names a trap, reproduce the trap before writing the test that pins it —
revert the fix and watch the test fail, as `implement-bead`'s RED step intends. A test written from
a plan's description of a bug is not evidence the bug exists.
**Seen before.** None found.

## Smoke tests raced the debounced validation and moved nothing

**What happened.** Clicking the new walk buttons immediately after writing orders did nothing:
`problemTargets` was still empty, so `stepDiagnostic` returned `null` and the click was a correct
no-op. It reads exactly like a broken button.
**Why.** Validation is debounced, and no assertion in the test waited for it — `orders-status`
reporting "0 errors" is true before validation has run at all.
**Cost.** Three smoke runs, about 20 minutes, spent looking for a wiring fault that was not there.
**Prevent by.** Any smoke test that walks, counts or jumps between problems should wait on the
header's `problems-chip` showing a non-zero count first. That is the only barrier on screen that
means "validation has landed"; a per-unit count of zero does not.
**Seen before.** None found.
