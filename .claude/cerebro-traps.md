# Traps this project has already paid for

Facts about *this* project that an agent should know before it starts — each one already cost a
retrospective, a CI cycle or an hour of somebody's confusion. Planners and implementers read this
file at the top of their work (`skills/plan-bead`, `skills/implement-bead`); it is a list of facts,
not rules, so if a bead touches one, say so and say what to do about it.

**Tracked on purpose**, beside `.claude/cerebro-project.conf` and `.claude/cerebro-roster`. A trap
the whole team has already paid for is a fact every clone needs, and a file under the git-ignored
`.cerebro/` would vanish on a fresh clone and take the traps with it.

**Curated, not appended to.** Forge proposes an entry during its sweep, quoting the retrospective's
`**Prevent by.**` that produced it, and the navigator accepts or declines. Nothing else writes here —
an implementer is the worst judge of whether its own pain generalises, and every retrospective has a
`Prevent by`, so an open door would turn this into a log nobody reads.

## The traps

- **WebKit's driver** answers `""` for text it considers clipped, so a Chromium assertion can pass
  while the native shell shows nothing. `native` is the job that tells you.
- **The smoke suite rebuilds the web bundle with the service worker disabled**, so a PWA run
  straight afterwards fails with timeouts that look like a broken worker.
- **A persisted setting's old default must be migrated rather than clamped.**
- **`vite preview` without `--strictPort`** silently serves somebody else's bundle.
- **Never ask for an effect-level test in `packages/shared`.** That package has no jsdom by decision
  (ah-nass): its component tests render with `renderToStaticMarkup`, which runs no effects, attaches
  no refs and fires no timers, and shows a zustand store only its module-load default. A plan that
  names a `*.test.tsx` there and asks it to observe something an effect did is asking for a test the
  harness cannot run — four beads paid about half an hour each discovering that. Plan the rule into a
  pure module and put the test on that instead; `packages/shared/src/testing/README.md` has the
  pattern and its worked example, and store state goes through `testing/renderWithStoreState`.
