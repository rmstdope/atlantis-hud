# ah-pbyfh

## The review packet was too large to paste into the review prompt

**What happened.** `produce-bead` says to paste `review-packet`'s output whole, never edited, as the cold review's prompt. For PR #2038 the packet was 1,942 lines, about 95 KB or 40k tokens, because the diff is 10 files with two new modules and their tests. A single Read of it stopped at line 1,022 under the read cap. Pasting it would have meant the producer re-typing about 40k tokens by hand, with every chance of the drift the rule exists to prevent. Instead the review sub-agent was told the path of the unedited file the script wrote, and read it in pages. The review comment says so.

**Why.** The packet carries the whole diff inline. Nothing in the skill or the script allows for a diff larger than a producer can echo back.

**Cost.** About ten minutes, spent deciding how to keep to the rule's intent and reading half the packet into context to no purpose (about 25k tokens).

**Prevent by.** `produce-bead`, *The review loop*: name a size above which the packet is handed over as the file `review-packet` writes, rather than pasted. Alternatively, have `scripts/review-packet` take an `--out <file>` and print the one-line prompt that names it, so the bytes the sub-agent reads are still exactly the script's.

**Seen before.** No. A grep of `docs/retrospectives/` for "packet" finds nothing.
