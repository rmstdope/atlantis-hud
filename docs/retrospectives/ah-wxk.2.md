# ah-wxk.2 — retrospective

- **Implementer:** Storm
- **Date:** 2026-08-16
- **PR:** #331

## `vi.fn().mockResolvedValue(x)` does not check `x` against the mocked method's return type

**What happened.** `fakeAdapter()`'s `parseReportFull` and `parseReportClassified` entries (both
declared `Promise<ParsedReport>` on `CoreAdapter`) were built with
`vi.fn().mockResolvedValue(reportParseResult)`, where `reportParseResult` is shaped as
`ReportParseResult` — a different, unrelated type. `pnpm --filter @atlantis/core-client run
typecheck` passed clean, and the tests that exercised those two methods passed too, because
nothing in the suite asserted on their resolved value. The mismatch was caught only by Copilot's
review on the PR, not by `tsc` or by running the tests.

**Why.** `vi.fn()` with no explicit type parameter infers a very loose function type, and
`.mockResolvedValue(x)` accepts whatever `x` is without checking it against the property slot
the resulting mock is later assigned to (`parseReportFull: vi.fn().mockResolvedValue(...)` inside
an object literal typed as `CoreAdapter`). The assignment of the *mock itself* to that slot is
what gets checked, and a `Mock` is structurally compatible with almost any function type. So a
helper built exactly as this bead's plan prescribed — "one `vi.fn().mockResolvedValue(...)` per
method" — has a blind spot at precisely the point it exists to prevent: an entry that resolves
with the wrong shape compiles and runs green.

**Cost.** One Copilot review round trip — cheap here because the review caught it before merge,
but the same helper pattern is what `ah-wxk.3`'s test plan is likely to reuse for its own fakes.

**Prevent by.** When writing a `fakeX()`/`vi.fn().mockResolvedValue()` helper typed against an
interface, give the literal value passed to `mockResolvedValue` its own type annotation
(`const parsed: ParsedReport = aParsedReport();` then `.mockResolvedValue(parsed)`) rather than
relying on inference through the mock — the annotation is what forces `tsc` to check the value
against the right type, since the mock's own type never will. Worth a line in a future revision of
this pattern wherever it is documented (`test-driven-development`'s "When changing a function's
contract" note is the nearest existing guidance and doesn't cover this specific gap).

**Seen before.** None found (`docs/retrospectives/` had no `vi.fn`/`mockResolvedValue` hit before
this file).
