# ah-vwdi — retrospective

- **Implementer:** Wolverine
- **Date:** 2026-08-21
- **PR:** #519

## A global CSS rule silently outranked a Tailwind utility, and the markup still read correct

**What happened.** The bead shipped once, was verified by the navigator, and failed: the dialog ran
to the bottom edge. The plan, the previous implementer and the verifier all read
`pt-[10vh]` + `max-h-[80vh]` and concluded the arithmetic was right — it is — and the cause was
declared "genuinely unknown from reading alone". Measuring it in the browser took one throwaway
Playwright test that dumped `getComputedStyle` and the ancestor chain: computed `max-height` was
`648px` on a `720px` window, i.e. **90vh, not 80vh**. `theme.css:361`
(`[role="dialog"][aria-modal="true"] { max-height: 90vh }`, added by ah-ziv) is specificity 0,2,0 and
outranks a utility class at 0,1,0, so `max-h-[80vh]` had never applied at all.

**Why.** Established. A component-level Tailwind size utility cannot override a repository-wide
attribute-pair rule without the important modifier. Nothing in the markup shows this — the class is
present, spelled right, and generated in the CSS bundle — so reading the component can never find it.

**Cost.** A full verification cycle, a P0 reopen, a re-plan amendment, and a second implementation
session. The diagnosis itself, once measured, took about five minutes.

**Prevent by.** Two concrete things:

1. `theme.css`'s `[role="dialog"][aria-modal="true"]` block is a specificity trap for every one of
   the ten dialogs it governs: any component that tries to set its own `max-height`, `max-width` or
   `overflow` loses silently, with markup that reads correct. A comment on that block naming the
   hazard, and/or lowering it to `:where([role="dialog"][aria-modal="true"])` (specificity 0,0,0) so
   components win by default, would close the class of bug rather than this instance. That is a
   change to shared styling outside a planned bead, so it is recorded here rather than made.
2. **A layout assertion against `renderToStaticMarkup` output is not a test.** `GameDataDialog.test.tsx`
   asserted the class name was in the markup, and passed throughout — the class was there and did
   nothing. Anything about size, position or scrolling has to be measured in Playwright; the plan
   already said that for the scrolling half and should say it for the margin half too.

**Seen before.** `ah-ziv` — the bead that added this very rule, and whose own retrospective is about
a specificity surprise in the same stylesheet ("`:root` at 0,1,0 beat the injected `html` rule").
Second sighting of *CSS specificity in `theme.css` defeating what the code appears to say.*
