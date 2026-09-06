# ah-rgkk.2.2 — retrospective

- **Implementer:** Wolverine
- **Date:** 2026-09-06
- **PR:** #1006

## Widening the preview gate broke a whole-report regression test the plan did not name

**What happened.** The plan asked, correctly and with its reasoning spelt out, for the gate at
`effects.rs:500` to gain `&& study.is_none()` so a unit whose only order is `STUDY` still gets a
preview row. It then checked that change against every *consumer* of the wire — `mergePreview`,
`previewStatus`, the CSS — and concluded the change was invisible, which it is. What it did not
check is the repository's own regression bar for the gate: `crates/core/tests/orders_preview.rs`'s
`the_committed_template_previews_exactly_its_one_real_effect`, which asserts the committed turn-71
template previews as *exactly six rows*. The template is full of `@study`, so the gate change made
it twenty-four, and the first `pnpm run check:fast` after the wire landed failed there:

    assertion `left == right` failed: left: 24  right: 6

The failure is the test doing its job — a gate widening is precisely what it exists to catch — but
it arrived as a red suite in the middle of an increment rather than as a step in the plan, and
working out whether 24 was right needed the template read and the four `GIVE` rows separated from
the eighteen new study rows. The same shape, smaller: the plan named
`packages/shared/src/workspace/UnitPanel.test.tsx:248` as the one place a new required wire field
breaks the typecheck, and `UnitTableDock.test.tsx` builds five more `UnitPreview` literals of its
own.

**Why.** A plan that changes what the preview *emits* traces the change forward to what reads the
wire, which is the natural direction and is where the user-visible risk is. The tests that assert on
the wire's own shape — a row count over a whole committed report, an object literal that must list
every field — are found by grepping the type and the gate rather than by following the data, and
nothing prompted that.

**Cost.** About twenty minutes: one failed gate run, reading the template to justify the new
numbers, and a second run.

**Prevent by.** `plan-bead`'s *Files to change* should ask, for any change that adds a required
field to a wire type or widens a preview gate, for a `grep` of the type name and of the gate's own
integration test across `crates/*/tests/` and `packages/**/*.test.*`, with the answer written into
the plan. It is one command per plan and it names the files the implementer will otherwise meet as
a red suite.

**Seen before.** None found for this test; `ah-bu2c` records the neighbouring shape — a plan's own
regression test passing on main — and `ah-vfq` is the only other file naming `orders_preview.rs`.
