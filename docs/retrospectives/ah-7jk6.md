# ah-7jk6 retrospective

## cerebro's own gate cannot go green from a consumer's submodule

**What happened.** The bead's diff was inside `.cerebro/cerebro`, so its gate was cerebro's
`bash tests/gate`, run in `<tree>/.cerebro/cerebro` as produce-bead's *Workspace* directs. It went
RED on two counts, neither from the diff. First, fifteen `tests/fleet-*.sh` suites and
`tests/web-console.sh` timed out ("after 90s, still waiting for: Rogue's first session"). The five
that touch assign-bead each passed run alone. Second, the web console UI leg stopped at
`pnpm install --frozen-lockfile` with `ERROR packages field missing or empty`: pnpm walks up from
`web-console/` and finds the consumer's `pnpm-workspace.yaml`, not cerebro's. CI was green on all
four jobs.

**Why.** The UI leg: pnpm resolves its workspace by walking up the directories, and inside a
consumer the first workspace it meets is the consumer's. The timeouts: not established. They look
like the parallel fleet suites contending on this machine, as ah-3kge's lease test did.

**Cost.** About ten minutes rerunning suites one at a time to separate load from regression. The PR
went out with a gate that was locally red, defended in prose.

**Prevent by.** cerebro's `tests/web-console-ui` could run pnpm with `--ignore-workspace`, or with
the directory pinned, so it installs the same way inside a consumer as in cerebro's own checkout.
produce-bead's *Workspace* paragraph for cerebro beads could say which gate legs are meaningful
from a submodule.

**Seen before.** `docs/retrospectives/ah-3kge.md`, *Two cerebro tests failed on runs unrelated to
the diff*: the same load-sensitive local red. The pnpm workspace collision: none found.
