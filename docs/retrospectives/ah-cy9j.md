# ah-cy9j — retrospective

- **Implementer:** Wolverine
- **Date:** 2026-09-09
- **PR:** #1078

## The plan's `eslint-disable-next-line` example was a shape that does not suppress anything

**What happened.** The plan prescribed the eight group-C disables in this exact shape, directive
first and the reason wrapping onto the following line:

```ts
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on openGameId and gameEpoch on
    // purpose (see above): a rename hands the shell a fresh `game` under the same id.
  }, [client, openGameId, gameEpoch]);
```

`eslint-disable-next-line` disables **the one line immediately after it**, which here is the second
line of the comment, not the dependency array. Applying it at all eight sites took
`npx eslint src | grep -c exhaustive-deps` from 14 to **22** — up, not down to the plan's 6 — because
each site now had both its original finding and a new `Unused eslint-disable directive`. The fix is
to put the prose first and the bare directive last:

```ts
  // Keyed on openGameId and gameEpoch on purpose (see above): a rename hands the shell a fresh
  // `game` under the same id, and the notes it would reload are the same notes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, openGameId, gameEpoch]);
```

**Why.** The `--` suffix form is real ESLint syntax, so the shape reads as correct; what it cannot
do is carry a reason onto a second line, because that second line is then the one being disabled.
**Cost.** About five minutes: one lint run, a `git checkout` of the file, and re-applying all eight.
Cheap only because the plan stated the expected count after each increment (29 → 17 → 14 → 6 → 2 →
0), so a result of 22 was obviously wrong rather than something to reason about.
**Prevent by.** A plan that prescribes a literal code shape for a suppression directive should put
the reason **above** the bare directive, never after a `--` that has to wrap. Worth `plan-bead`
knowing, since this is the first `eslint-disable-next-line` in the repository and the plan's shape is
what the next one will be copied from.
**Seen before.** None found — `grep -rl "disable-next-line" docs/retrospectives/` returns nothing.

## The stated count after each increment is what made every mistake cheap

**What happened.** Three separate edits landed wrong — the disables above, and two comment
insertions in group D that Python's line-index arithmetic put inside a `return () => {` block and
ahead of the JSDoc they belonged to. Each was caught within one lint run, because the plan named the
exact finding count expected after every increment and the number simply did not match.
**Why.** The count is a cheap, unambiguous check that does not depend on reading the diff.
**Cost.** Negative — it saved time rather than costing it.
**Prevent by.** Nothing to prevent. Recorded as the counterpart to the finding above: this is worth
other planners copying for any bead whose increments drive a number to zero.
**Seen before.** None found.
