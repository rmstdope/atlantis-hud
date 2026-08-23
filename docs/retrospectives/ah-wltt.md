# ah-wltt — retrospective

- **Implementer:** Rogue
- **Date:** 2026-08-23
- **PR:** rmstdope/cerebro#97, and this repository's bump PR

## An acceptance criterion counted with a different command from the one that set its baseline

**What happened.** The plan's *Validation* set a baseline of "**58** bolded normative openers" using
`grep -o '^\*\*[^*]*\*\*' | sort`, and then made acceptance criterion 4
`grep -c '^\*\*' skills/plan-bead/SKILL.md` **lower than 58**. Those are two different measurements:
the first counts complete bold openers on a line, the second counts every line *beginning* with
`**`, which on the untouched file was already 60. So the criterion was failing against its own
starting point before a line was edited, and a restructure that reflows paragraphs moves it in either
direction for reasons that have nothing to do with duplication. Worse, the four duplicated tellings
the bead exists to remove were *inline* prose, not line-opening bold — so consolidating them could
not lower either number.

**Why.** Established. The criterion was written from the reasonable-sounding assumption that
"fewer duplicated rules" implies "fewer bold openers", and the two commands were written at different
moments in the plan without being run against each other.

**Cost.** Perhaps fifteen minutes: two rounds of genuinely useful consolidation done partly to chase
a number, then the judgement not to pad the file further and to report the criterion unmet in the PR
body instead. No CI cycles.

**Prevent by.** A plan that sets a numeric acceptance criterion should **run the command against the
unchanged tree and quote the baseline it printed**, in the same section, using that exact command —
not a related one. `plan-bead`'s *Everything you cite must exist* already makes a planner verify
cited files and lines; the same rule applied to cited *numbers* would have caught this, since running
`grep -c '^\*\*'` once would have shown 60 rather than 58.

**Seen before.** None found. The nearest are `ah-ssd` and `ah-x7gr`, which are plans wrong about the
repository rather than plans wrong about their own measurements.
