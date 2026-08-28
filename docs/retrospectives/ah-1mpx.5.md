# ah-1mpx.5 — retrospective

- **Implementer:** Wolverine
- **Date:** 2026-08-28
- **PR:** #767

## A smoke test cannot count the units table's rows, and a plan asked it to

**What happened.** The plan's *test plan* said to "assert relations, not counts" in the new smoke
spec — that `Other factions` lists **more rows than *This hex* does**, that pinning **reduces** the
row count, and that the way out **restores** it. Written literally against
`page.getByTestId("panel-units").locator("tbody tr[data-testid]")`, the first of those failed with
`Expected: > 17 / Received: 17`, and the last would have been wrong in the same way. The units table
windows its rows (`windowRange`, `OVERSCAN`), so the DOM holds whatever fits the viewport — 17 here
— whether the list behind it is 92 long or 254. Two of the four new walks failed on it.

**Why.** Established. The advice not to hardcode a total is right and the relations named are the
right relations; the mistake is only in *where* they are read. The one place the whole list is
counted is the pane header's hint (`— other factions, 254 units`, `— Thane's Ring (10), 52 of 254
units`), which `headerFor` builds from `units.length` rather than from anything rendered — and which
is also the figure a person actually reads. The rewrite parses that instead and asserts exactly the
relations the plan named.

**Cost.** One full run of the new spec across both projects (~2m20s) plus the rewrite, about 25
minutes. No CI cycle: it was caught locally, because this bead's plan asked for `pnpm run test:smoke`
before the PR.

**Prevent by.** A line in `.cerebro/traps.md` (or in whatever a project keeps for this) saying that
**any assertion about how long the units list is must read the pane hint, never a `tbody tr` count**,
because the table is virtualised. `ah-1mpx.2` and `ah-1mpx.3` did not hit it — the Army sources they
walk are short enough to fit the window — so this will keep being written correctly by accident until
somebody points a smoke test at a whole-report source, which is what this bead was. The same rule
explains why increment 11's fourth walk has to press `End` to reach a concealed unit at all: rows
that sort last are simply not in the DOM.

**Seen before.** None found. `ah-67h8.md` mentions `toHaveCount` but about visibility assertions on
a popover, not about windowed rows.
