# ah-7bxc — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-09-09
- **PR:** rmstdope/cerebro#353, and the pointer bump on this board

## An acceptance criterion the plan's own *Out of scope* forbade satisfying

**What happened.** The plan's *Validation* criterion 2 read: "Inserting any clause into
`hint_clauses` at `Movement` or above fails `no_screen_loses_a_required_hint_tier_at_its_own_width`
— **and no other test**." Its *Out of scope* read: "**Any change to what the screen draws.** If an
increment makes an existing `TestBackend` case red, the increment is wrong, not the case." Both
cannot hold. A new clause changes the drawn header, so the render-asserting cases
(`the_ordinary_screen_keeps_every_hint_at_a_hundred_columns`, `a_pinned_bead_keeps_the_header_line`,
`the_health_hint_is_offered_and_gives_way_before_the_kept_keys`) must go red; making them survive
means editing what they assert, which the same plan forbids. Inserting a `Movement` clause turns
six tests red, not one. The plan's *Context* states the deliverable differently and achievably —
"one named test that says which screen, which tier would be lost, and by how many cells" — and that
is what was built.

**Why.** *Context* and *Validation* were written to different standards and never checked against
*Out of scope*. The gap between "the diagnosis is now available" and "the failure is now singular"
is invisible until somebody actually inserts a clause and counts what goes red, which no step
before the review does.

**Cost.** About fifteen minutes: the reviewer ran the experiment and raised it as its top finding,
and answering it took a reading of the plan's three sections against each other plus an escalation
to the navigator. No code was written or thrown away — the change is unaffected either way.

**Prevent by.** `plan-bead` writing a *Validation* section should check each acceptance criterion
against the plan's own *Out of scope* and ask whether any change the bead is permitted to make
could satisfy it. Criterion 2 here is satisfiable only by a change *Out of scope* forbids, which is
readable from the plan alone, before an implementer is started.

**Seen before.** Three, and this is the fourth: `ah-a2k.2` ("The plan's acceptance criteria
contradicted a smoke test the plan never mentioned"), `ah-gfzu` (two acceptance criteria that
"cannot both hold on a rightward drag"), and `ah-3mwm` and `ah-rgkk.6` on the same "cannot both
hold" shape. Every one of them is an acceptance criterion that no permitted change could meet, and
every one was found by an implementer or a reviewer rather than at planning time.
