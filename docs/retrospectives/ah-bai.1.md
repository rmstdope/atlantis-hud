# ah-bai.1 — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-08-16
- **PR:** #345

## A bug found and fixed on the core side had an untested twin on the client side

**What happened.** The bead's own REFACTOR-phase review (an independent general-purpose agent,
standing in for rubber-duck) found that `order_argument_completions` in `grammar.rs` treated a
caret right after a *closed* quote as still-mid-word, dropping a complete token and missing the
`COMPLETE` suggestion `BUILD "Big Boat"` should offer. I fixed it and added a Rust test. The
Copilot PR review then found the same conceptual bug's independent twin in
`packages/shared/src/orderCompletion.ts`: the TypeScript word-boundary regex
(`/(?:^|\s)([A-Za-z]*)$/`) also requires whitespace before the half-typed word, so it never
matched at all right after a closing quote — an explicit `Ctrl+Space` summons there stayed silent.
Neither my own RED-phase tests nor the independent review agent's pass caught this second
instance, even though the agent was explicitly asked to check "consistency with sibling code
paths" and reported it had hand-traced the TS regex.

**Why.** The core and the client each parse "where is the caret, argument-position-wise"
independently — the core via the lexer's tokens, the client via a standalone regex — and the two
have to agree on every boundary case for the popup to work end to end. Finding and fixing an edge
case in one does not imply the other was checked against the same input; they are separate
implementations of the same idea; a review focused on "does the TS regex look right" in isolation
missed that it needed re-checking against the specific edge case the *sibling* layer had just
turned out to be wrong about.

**Cost.** One extra review round-trip (Copilot comment → fix → reply → resolve), no extra CI
cycle beyond the one already needed for the fix commit — about 15 minutes.

**Prevent by.** When a review (self- or reviewer-driven) finds and fixes an edge case in one half
of a core+client duplicate-boundary-detection pair, explicitly re-check the *other* half against
the identical input before considering the fix complete, rather than treating the fixed layer's
new test as sufficient evidence the feature is now correct end to end.

**Seen before.** None found.
