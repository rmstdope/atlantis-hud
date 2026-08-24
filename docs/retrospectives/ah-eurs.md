# ah-eurs — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-08-24
- **PR:** #674

## The plan named a surface as unaffected, and it was the surface that broke

**What happened.** The plan's *Out of scope* said: "The map-wide findings list and the header chip.
Neither changes; the new code is excluded from `findingsForHex`, so counts elsewhere stay as they
are." I built to that and did not check it. It is wrong: `findingsByHex` (`orderEditor.ts:226`) is a
separate walk over the same diagnostics, feeding the header chip's count and the global
`ProblemsPanel`. Without the same exclusion, every pooled shortfall was counted once more per
contributing line, and each pointer's "See Problems for the hex" was rendered as an entry in the
very list it points at. The Copilot review caught it; nothing in my gate would have.

**Why.** The plan asserted an outcome ("counts elsewhere stay as they are") and gave a reason that
only covered one of the two functions producing those counts. The same section's *Files to change*
listed `orderEditor.ts` for `findingsForHex` alone, so the plan's own file list agreed with the
mistaken claim and there was nothing to notice. A related sign the plan had drifted from the code:
its *design of the code* was written against a shape of `report_shortfalls` that `ah-3ddq` had
already replaced — its `claims`/`pooled_tags` accumulators and its proposed `Contributor` struct no
longer exist, and the `DeferredToPool` verdicts carry that data now.

**Cost.** One review round and one extra CI cycle, roughly 25 minutes. It would have cost a failed
verification had the review not caught it.

**Prevent by.** When a plan says a surface is unaffected, grep for the surface rather than trusting
the sentence — here, `grep -rn "part-of-hex-shortfall\|findingsFor\|findingsBy" packages/shared/src`
before the PR would have shown two walks and one filter. A plan's *Out of scope* is a claim about
code, and an implementer is the last reader in a position to check it.

**Seen before.** none found.
