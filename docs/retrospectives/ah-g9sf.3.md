# ah-g9sf.3 — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-09-12
- **PR:** #1177

## A defaulted policy parameter hid a missed call site from the compiler and the suite

**What happened.** This bead threads a new `OrderCommentSyntax` argument through about twenty
shared functions, each defaulting to `"origins"` as the plan specified. The plan enumerated the
files to thread it through, and the enumeration was incomplete: `turnDiff.diffOrders` — and its one
caller in `AppShell.tsx` — was not on it. Because the parameter defaults, the missed seam type-checked
cleanly and all 4207 existing tests passed, while a Trident game's Changes view would have silently
reported every unit as absent from both drafts (`unit 42;the miner` parses to zero blocks under the
Origins default). The review's cold read found it; nothing I ran would have.

**Why.** A defaulted parameter cannot fail a call that omits it, so "have I reached every reader?"
is a question neither `tsc` nor the suite can answer — and the plan's file list was the only thing
standing in for that answer. The same round found a second defect of the same shape in reverse: my
`bareWords` change ran the new mid-word branch for *every* semicolon, so comment-line prose was
scanned as order words, and again every existing test passed because none covered a line opening
with `;`.

**Cost.** One review round and one CI cycle, about twenty-five minutes, plus a second round for the
half of a finding I fixed one layer too low (`isCommand` but not `atTopLevel`).

**Prevent by.** When a bead threads one new argument through many existing functions, write the
per-seam guard test *first*, from the plan's own file list, and then `grep` for every caller of each
threaded function and check each appears in it — the list is what the compiler cannot check, so it
needs a test of its own. `orderCommentPropagation.test.ts` in this PR is that guard and it is what
should have carried `diffOrders`; building it before the threading rather than after would have
turned the missed seam into a failing test instead of a review finding.

**Seen before.** `ah-lyg6.3` — five agreed behaviours built and never wired, same cause ("every one
of the five is a *widening* — a new optional parameter... TypeScript cannot fail a call that omits
an optional argument"), same detector (the reviewer's cold read). `ah-enik` records a related
count: a check passed with 78 of 99 cases misclassified because the arguments were optional.
