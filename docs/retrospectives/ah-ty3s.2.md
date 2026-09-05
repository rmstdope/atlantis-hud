# ah-ty3s.2 — retrospective

- **Implementer:** Wolverine
- **Date:** 2026-09-05
- **PR:** #981

## An orders-import smoke walk is blocked by the summary dialog the import itself raises

**What happened.** The plan's increment 9 specified a `tests/smoke/workspace.spec.ts` walk that
imports an orders file carrying a stale `unit new-1` block, presses Replace, and then selects the
unit to read its block back. It timed out at `selectUnit`, on both projects:
`orders-import-summary-backdrop ... intercepts pointer events`. The import validates the file *as it
arrived*, before the load-time repair runs, so the stale block's own lines raise the import summary
dialog, which sits over the whole workspace until it is closed. The spec has to close it — as the
neighbouring `ORDERS_IMPORT_WITH_ERROR` walk already does — before touching anything else.

**Why.** Established. The plan's *Out of scope* section says in as many words that
`replaceOrdersImport` validates `pending.text` before the repair, and reasons from that to leaving
the dialog alone; it did not carry the consequence forward into increment 9, which described the
walk as if the import were clean.

**Cost.** One full `pnpm run test:smoke -- workspace` run, about 11 minutes, plus a targeted re-run.

**Prevent by.** A plan that specifies a smoke walk importing an orders file should say in that
increment whether the file is expected to validate clean, and if not, that the walk closes
`orders-import-summary` first. Any file containing a block the core objects to — which a *stale*
block is, by construction — raises it.

**Seen before.** None found.
