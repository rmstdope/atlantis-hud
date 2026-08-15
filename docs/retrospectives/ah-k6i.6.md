# ah-k6i.6 — retrospective

- **Implementer:** Storm
- **Date:** 2026-08-16
- **PR:** #292

## The plan's own code snippet introduced the regression its bead explicitly forbade

**What happened.** The plan's `runBatch` rewrite (design section "`AppShell.tsx`") gave the exact
line `if (!game || !viewerFactionId) return;` as "today's guards, kept as one early exit". They were
not today's guards: the pre-move `runBatch` had no such early return - when `chooseViewerFaction`
resolved to `{ kind: "decided", factionId: null }` (every file in the batch unreadable or headerless,
and nothing on screen), the old code still ran `planReportBatch`, produced a fully-skipped plan, and
called `setImportSummary` with a reason per file. Copied verbatim, the early return silently did
nothing in that case instead - a real regression against this same bead's own "No player-visible
change" promise. Copilot's review caught it (`AppShell.tsx:1019`); the fix moved the nullability into
`walkBatch` itself (`viewerFactionId: string | null`, matching `planReportBatch`'s own signature) so
the module always returns a full `BatchWalk` instead of the caller having to remember to special-case
it.

**Why.** The plan was written from `AppShell.tsx` at a fixed commit and stated the guard's origin
from memory rather than by re-checking the code being replaced; nothing in the increments or the
test list would have caught it; because `viewerFactionId` is `null` only from a fairly narrow gap
(`chooseViewerFaction` ties on nothing at all), it is also not the sort of case a quick manual smoke
check surfaces.
**Cost.** One extra review round-trip: a second commit, a second `update-branch` catch-up, and a
second full CI cycle (~20 minutes) that a correct first pass would not have needed.
**Prevent by.** When a plan's code snippet is offered as "unchanged from today" or "today's X, kept
as Y", diff it against the actual line it claims to preserve before typing it in, rather than trusting
the prose describing it - the same discipline the plan itself asks implementers to bring to every
other detail it hands off.
**Seen before.** None found (`grep -rl "Copilot\|review caught\|plan's code" docs/retrospectives/`).
