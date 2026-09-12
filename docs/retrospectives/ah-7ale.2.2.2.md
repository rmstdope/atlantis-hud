# ah-7ale.2.2.2 — retrospective

- **Implementer:** Wolverine
- **Date:** 2026-09-12
- **PR:** #1208

## The plan named a user-visible sentence from the wrong surface, and the smoke case failed twice on it

**What happened.** The plan's increment 6 asked the smoke case to assert, on the sender's ITEMS
cell, "the `Sends <n> <TAG> to unit <target>.` sentence `transportSentSentence` produces
(`packages/shared/src/unitPreview.ts:541`)", with the reach sentence in that same cell as the
control. Neither is what the unit table renders. The control failed first —
`getByTestId('unit-row-9431').locator('[data-predicted="true"]')` found no element at all, because
a refusal *keeps* the goods, so nothing in the row's figures changes and no cell is marked
predicted. Corrected to a count of 0, it then failed on the sent sentence: the cell says
`wood WOOD 15, down from 20 … wood: sent 5 to Trader (6857).`, the table's own wording.
`transportSentSentence` is the unit *panel's*. Both failures needed a browser run to see.

**Why.** The plan cited the sentence's producing function and its line, which is exactly the care
`implement-bead` asks for — but a producing function does not say which surface renders it, and the
plan asserted on a different one. The `[data-predicted="true"]` control was an assumption about
what a refusal leaves behind that nobody checked against the rendering.

**Cost.** One full `pnpm run test:smoke` (16.3m, 768 passed / 2 failed) plus two targeted reruns,
about 25 minutes. No CI cycle: it was caught before the PR opened.

**Prevent by.** When a plan names a user-visible string *and* the element it should appear in, the
implementer should read the component that renders that element before writing the assertion — not
only the function that produces the string. `implement-bead`'s *When the plan is wrong* already
says a helper the plan cites is read before it is built on; the same care applied to the
**surface** a cited string appears on would have caught both failures at the desk. A plan is also
better off naming the `data-testid` and a phrase the implementer can grep for in the rendering
component than a Rust- or TS-side producer.

**Seen before.** `ah-zpq3` — "The plan's opening test asked for something the static renderer
cannot see", the same shape one layer up (a test asked of a renderer that could not answer it).
