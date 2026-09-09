# ah-l09a.3 — retrospective

- **Implementer:** Wolverine
- **Date:** 2026-09-09
- **PR:** #1156

## A cell's `explain` sentence states the absence the cell itself has stopped stating

**What happened.** The plan listed five table cells by file and line and said what each should
say for a unit whose report line was cut short. Every one of them has a companion `sr-only`
sentence from the order-diff machinery — `explain("movement")`, `explain("flags")` — which the
plan does not mention and which the diff does not touch. So the plan's own acceptance
(*"the row contains neither `Movement not disclosed` nor `No flags set`"*) is unsatisfiable as
written: after the change the row still reads
`<span class="sr-only" data-explains="movement">Movement not disclosed. Nothing this month changes this.</span>`,
and the flags one lists every flag as `off` for a unit whose flags were never read. The first
test written to the plan's words went red on the implementation that was correct, and the
assertion had to be narrowed to the cell's own markup twice — once for this, once because the
review's suggested `toBe(4)` count was also wrong (five render, the `explain` sentence repeating
the phrase).

**Why.** `explain(...)` is a separate surface, added by a later bead, that sits inside the same
`<Td>` as the value. A plan written by reading the cell's value expression does not see it.
**Cost.** About fifteen minutes and one review finding.
**Prevent by.** A plan's *Files to change* section, when it names a `<Td>` in
`UnitTableDock.tsx`, should say what that cell's `explain(...)` companion sentence currently
says and whether it is in scope. And an assertion on a phrase that appears in both should name
the column — `data-column="flags"><span class="text-warn">not known</span>` — never count
occurrences.
**Seen before.** `ah-rgkk.1` and `ah-rgkk.3.3` — both an `sr-only` companion sentence being
real text that a test did not expect to read. This is the third sighting of that family.

## Left behind: the `explain` sentences still describe an unread unit confidently

**What happened.** Not a cost to this bead, recorded because nobody else saw it: for a unit
with `read: "nothing"`, the row's hidden sentences still read `Movement not disclosed.`,
`No skills.`, `No items.` and every flag as `off`. The visible cells now refuse; the
screen-reader text beside them does not. It is out of this bead's scope and out of
`ah-l09a.4`'s, so unless it is filed it will not be picked up.
**Why.** The epic's plans divide by visible surface, and this text is not one.
**Cost.** None here.
**Prevent by.** Filing it as a bead.
**Seen before.** None found.
