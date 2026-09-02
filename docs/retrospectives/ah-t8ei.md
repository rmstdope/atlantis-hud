# ah-t8ei — retrospective

- **Implementer:** Rogue
- **Date:** 2026-09-02
- **PR:** #877

## A plan that adds a prohibition did not say which existing tests depend on the behaviour it forbids

**What happened.** The bead forbids a mage from giving men. Its plan is thorough — every file, every
increment, six known traps — and it explicitly promises that "existing GIVE/TAKE/TRANSPORT suites
remain regression coverage". They did not. `cargo test -p atlantis-hud-core --lib orders::` failed on
`a_mage_diluted_up_past_level_two_by_a_gift_is_now_warned` (`semantics.rs`), whose whole setup was
**a FORC mage giving skilled leaders to another mage** — the exact order the bead makes impossible.
Worse, the scenario has no legal substitute: the only unit that can supply force-skilled men is
itself a mage, so the route the test covered is now unreachable in the game rather than merely
unreachable in this fixture.

**Why.** A prohibition bead is not symmetrical with a feature bead. A feature adds a path and leaves
existing paths alone, so "existing suites remain regression coverage" is usually true for free. A
prohibition *removes* a path, and any test that used that path as a convenient way to set up
something else — here, a merge that raises a skill level — breaks for a reason that has nothing to do
with the check under test. The plan's *Out of scope* correctly listed the behaviours not to change,
but nothing asked the mirror question: which tests currently depend on the behaviour being removed?

**Cost.** About fifteen minutes, and a judgement call that could have gone wrong. The tempting fixes
were both bad: deleting the test loses the study-outside-building coverage, and "fixing" the fixture
by making the giver mundane silently changes what the test asserts, because a mundane giver's men
carry no FORC to merge. The honest fix was to split it — one test reaching level 2 from the report so
the study check stays covered, one new test pinning that the gift route is gone.

**Prevent by.** `plan-bead`'s plan template should ask, for any bead whose rule *forbids* something,
one extra question alongside *Out of scope*: **which existing tests use the forbidden behaviour as
setup, and what happens to each?** A `grep` for the order form or the predicate's subject across the
test suites answers it in a minute at planning time, where the decision about what the replacement
test should assert belongs — rather than at implementation time, where it arrives as a red suite and
an implementer deciding alone what an existing test was really for. This is a change to the planning
role's template, not something to make from inside a planned bead.

**Seen before.** `ah-cw75` — the neighbouring case: a *plan section* invalidated by a rule change,
where the section stating a concrete expected output was the one most certain to go stale and the one
left un-revised. Same shape one level down: a rule change silently invalidating something written
before it, which nothing in the process is asked to go looking for. Two sightings of that shape now.
