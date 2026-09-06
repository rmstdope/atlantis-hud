# ah-rgkk.2.1 — retrospective

- **Implementer:** Storm
- **Date:** 2026-09-06
- **PR:** #1004

## The plan named one test literal that a new required wire field would break; there were eight

**What happened.** The bead added four **required** fields to `UnitPreview`. The plan's *Files to
change* named exactly one place that would therefore stop typechecking —
`packages/shared/src/workspace/UnitPanel.test.tsx:248` — and its acceptance criterion 4 turned that
into a check: "no file under `packages/shared/src/workspace/` other than `UnitPanel.test.tsx` is
changed". In fact eight object literals of that type exist across three files
(`unitPreview.test.ts` ×6 inline plus its `previewedRow` helper, `UnitPanel.test.tsx` ×1,
`UnitTableDock.test.tsx` ×8 including two helpers), and `pnpm run typecheck` reported thirteen
errors. The acceptance criterion was unmeetable as written; I met the bead and recorded the
deviation in the PR body instead.

**Why.** The plan located the literal it named by reading `UnitPanel.test.tsx`, not by enumerating
constructors of the type. Nothing forces that enumeration, and a required field on a wire struct
breaks *every* literal of it — which is more than a reader of two or three files will see.

**Cost.** One extra fast-gate cycle and about ten minutes: the first `check:fast` came back
`typecheck FAIL test FAIL fmt FAIL`, and de-duplicating a scripted insertion that collided with the
helper I had already edited by hand took a second pass.

**Prevent by.** When a plan adds a **required** field to a type that test fixtures construct
literally, it should name the enumeration rather than the sites: one grep, run while planning and
quoted into *Files to change* — for this repository,
`grep -rn "dissolving: false" packages/ apps/` finds every `UnitPreview` literal, because the last
field of the struct is the reliable fingerprint of a complete literal. An acceptance criterion that
asserts *which files are not changed* should then be dropped in favour of one that asserts the gate
is green: the first is a prediction the plan cannot make safely, the second is the thing actually
wanted.

**Seen before.** `ah-rgkk.1` — same family, same sibling bead: its plan named three assertions to
move and eleven tests actually broke. `ah-t2i` — a plan naming a specific test site that did not
hold up when the file was opened.
