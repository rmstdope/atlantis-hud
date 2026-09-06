# ah-rgkk.6 — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-09-06
- **PR:** #1003

## A test asserting a `toLocaleString()` figure was tautological, and the two locales I checked could not show it

**What happened.** The bead made a popup draw a pair, `8 → 12`, and review found the two halves
were formatted differently — `value` through `describeMenBriefly` (`toLocaleString`), `from` from
the report's raw string, so `4210 → 4,255`. I fixed it and pinned it with a test asserting
`value: (4255).toLocaleString()` and `from: (4210).toLocaleString()`, deliberately locale-neutral
because the app's own grouping follows the reader. Review then showed that expectation is *equal to
the raw string* in every locale with `minimumGroupingDigits: 2` — `(4210).toLocaleString()` is
`"4210"` under `es-ES`, `it-IT`, `pl-PL` and nine others — so the test passed against the exact
defect it was written for. I had verified under the default locale and `de_DE`, both of which group
at four digits, so my check could not have caught it.

```
en-US 4,210 / 42,100   de-DE 4.210 / 42.100   es-ES 4210 / 42.100   pl-PL 4210 / 42 100
```

**Why.** `minimumGroupingDigits` is a per-locale CLDR property, maxing at 2, and a four-figure
number is the exact width where locales disagree about whether to group at all. Five figures group
wherever grouping exists.
**Cost.** Two review rounds and two CI-less commits, about fifteen minutes.
**Prevent by.** Two things, either of which alone would have caught it. When a test asserts a
figure that went through `toLocaleString()`, use **five or more digits**, never four. And prove a
regression test red against the implementation it is written for — reverting the one line and
re-running took under a minute and is what finally established the test was worth having.
**Seen before.** None found — `grep -rl "toLocaleString\|locale" docs/retrospectives/` was empty
before this file.

## The plan forbade the fix its own doc comment asked for

**What happened.** The plan's *Decided by me* and *Known traps* both said `from` carries
`change.original` verbatim and must not be re-formatted; the `PopupChange` doc comment the same
plan supplied said `from` is "what the report said, **already formatted**". Those cannot both hold
where the figure beside it is grouped, and following the traps literally ships `4210 → 4,255` on
screen. The first review round asked for the re-format; I took it and recorded the departure in the
PR body and the bead's notes rather than handing back, since it is a defect on screen rather than a
decision anyone chose.
**Why.** The verbatim rule was written to stop a raw report string being parsed *unguarded*, and by
the time `from` is built the integer guard immediately above has already proved it a whole number.
The trap was right about the danger and wrong about the remedy.
**Cost.** A round of review argument, and a real risk of the wrong resolution: taken literally the
trap would have shipped the mixed pair.
**Prevent by.** Where a plan states a rule about a value's *format*, it should state it in the same
place as the format of the value beside it — a trap that names one half of a pair cannot be checked
against the other. `ah-rgkk.3`–`.5` inherit this function; the bead's notes now carry the
consequence (`Number.isInteger` admits `"1e3"` and `"4210.0"`, now silently re-rendered).
**Seen before.** None found.
