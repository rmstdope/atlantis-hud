# ah-2tj8 — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-08-21
- **PR:** #514

## The completion popup silently ate Enter in a new keymap test

**What happened.** A new smoke test typed `turn`, waited 700ms, pressed Enter, and expected
`TURN\n `. The document came back as `TURN ` — one line, no newline. The new Enter keybinding in
`OrdersEditor.tsx` appeared not to run at all: it was in the bundle (grepped `dist/assets`), the
setting was on, and neighbouring Enter tests in the same file passed. Six smoke runs and four
rounds of instrumentation went into it before the cause was clear: the autocompletion popup was
open on the half-typed keyword, and its own Enter binding sits at `Prec.highest`, so Enter accepted
the completion — which inserts the keyword **plus a trailing space**. That is exactly the observed
`TURN `, uppercase and space and all, and it looks nothing like "a popup took my keypress".
`page.keyboard.press("Escape")` before Enter fixed the test.

**Why.** Established. Any smoke test that presses Enter after typing a word the vocabulary knows is
pressing Enter at an open completion popup, and completion acceptance is indistinguishable from
keyword shouting by its output.

**Cost.** About an hour: six full `test:smoke` invocations plus four instrumentation cycles.

**Prevent by.** Two things, both cheap:

1. `tests/smoke/orders-editor.spec.ts` should say, where `enableOrderOcd` is defined, that a smoke
   test pressing Enter after a known keyword must dismiss the popup first — the file already
   carries a note about `acceptCompletion`'s 75ms interaction delay, and this belongs beside it.
2. Two instrumentation routes were dead ends and cost a cycle each, which is worth knowing before
   reaching for them here: **`console.log` is stripped from the production bundle** the smoke suite
   serves, so a page-console probe reports nothing and reads as "my code never ran"; and
   **`document.title` is owned by the shell**, which overwrites it on the next render. What worked
   was `container.current?.setAttribute("data-…", …)` on the editor's own element, read back
   through the `orders-input` testid the specs already use.

**Seen before.** `ah-6qp` names the same popup in a smoke test, but for its width rather than for
the keys it claims — not the same finding.

## `git checkout <file>` to undo instrumentation threw away three increments

**What happened.** `git checkout packages/shared/src/workspace/OrdersEditor.tsx`, run to strip debug
instrumentation, discarded every uncommitted change in that file — increments 5, 6 and 7 of the
plan, roughly 100 lines, none of it committed yet because the smoke tests they exist for were still
red. Re-applying took ten minutes and the diff had to be reconstructed from the session's own
history.

**Why.** Established: the file held both the instrumentation and the increment, and `git checkout`
does not distinguish them.

**Cost.** Ten minutes and a reconstruction that could have gone wrong quietly.

**Prevent by.** Committing each increment as the plan says — "each increment is a commit" — even
while a later increment's smoke test is still red; the editor increments were held back as one
uncommitted block precisely because they were being debugged together, which is when a revert is
most likely and most expensive. Failing that, `git stash -u` rather than `git checkout <file>`,
since a stash is recoverable.

**Seen before.** None found.
