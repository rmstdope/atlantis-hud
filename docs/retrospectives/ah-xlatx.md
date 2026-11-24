# ah-xlatx — every Dependabot major bump of a pinned action fails CI by design

**What happened.** Dependabot PR #1975 (actions/checkout 5 → 7) failed the `checks` job. The update
was sound: checkout v7 still runs on node24. The failure came from
`scripts/workflowActionPins.test.ts`, whose `EXPECTED_MAJORS` still said 5. The fix was one number.
Earlier the same day, ah-6pa89 (#1972, actions/setup-node 6 → 7) failed the same way and got the
same one-number fix.

**Why.** The pin test hard-codes a major for each action, so it disagrees with any major bump
Dependabot proposes. Dependabot cannot edit the test, so every such PR goes red, and the sweep files
it as a bug bead. The test protects against a downgrade to a pre-Node-24 major. A newer major is
never the risk it guards against.

**Cost.** One bugfixer pass per major bump of a pinned action: a bead, a worktree, a fast gate, a
review and two full CI runs of about 20 minutes each. That was two passes today.

**Prevent by.** Changing `scripts/workflowActionPins.test.ts` to assert a **minimum** major for each
action (`pin.major >= EXPECTED_MAJORS[action]`) instead of equality. The test would still catch a
pre-Node-24 pin, and Dependabot major bumps would go green on their own. Alternatively, read the
pinned action's `action.yml` `runs.using` and require `node24`, which tests the real rule directly.

**Seen before.** ah-6pa89 (#1972), same test, same shape; it filed no retrospective.
