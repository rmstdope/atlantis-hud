# ah-j1xd — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-08-19
- **PR:** #436

## The plan's increment order could not be built: increment 1's GREEN needed increment 4's change

**What happened.** Increment 1 was "widen the surface assertion, then darken the five light
accents"; increment 4 was "lighten the light panel and darken the two inks". Applying increment 1
exactly as written left the assertion red on `--color-brass on --color-panel is 4.34:1` and the same
for `warn`. The plan's own table gives brass as 4.59 — but that figure is measured against the *new*
panel `#f0ece2` from increment 4, not the panel that exists at increment 1. The accents cannot clear
AA until the panel moves, so increments 1 and 4 are one increment wearing two numbers.

**Why.** Established. The plan tabulates every ratio against the post-change panel, including for the
tokens it changes three increments earlier. Nothing in the increment list says which surface each
increment's numbers assume.

**Cost.** Small — one extra test run and a judgement call about whether to commit a knowingly-red
increment. I pulled the panel and ink values into the first commit instead, so no commit is red, and
said so in the PR body. Perhaps fifteen minutes.

**Prevent by.** When a plan's *Increments* section splits a palette change across increments, each
increment's stated ratios should name the surface they were measured against — or the increments
should be ordered so that every one of them is green on its own. `plan-bead`'s increment guidance is
where that belongs. The generalisable rule: an increment whose GREEN depends on a later increment's
value is not an increment.

**Seen before.** ah-k6i.6 and ah-5pp — both "the plan's own snippet or rule was subtly wrong". This
is the same family, in the arithmetic rather than in the code.

## The plan's rationale for the per-theme transparency cited the dark theme's terrain colour

**What happened.** The plan's Q4 argues that light mode must default to opaque panes because "light's
worst terrain is `terrain-unknown` `#161c24`". That hex is the **dark** theme's value
(`theme.css:87`); the light theme redefines every terrain as a light tint, and its own
`terrain-unknown` is `#e3dfd3` (`theme.css:198`). The composite was taken of the light panel over
dark-theme terrain — a pairing the application never renders, since terrains follow the theme.

**Why.** Established by reading both blocks and re-running the sweep. Not guessed.

**Cost.** About twenty minutes, spent re-deriving the whole measurement before starting, because a
wrong premise under a user-facing decision is a hand-back if the conclusion also falls. It did not:
against light's *own* terrains, 97 token/terrain pairs still fail AA at 20% transparency, so light
defaulting to 0 is right for a reason the plan did not state. I built the plan as written.

**Prevent by.** A planner compositing chrome against map colours must read the terrain values from
the same theme block as the text tokens — `theme.test.ts`'s pane assertion now does exactly this,
taking both from `extractBlock(css, opener)` for the theme under test, and is worth pointing at as
the reference implementation. More generally: when a plan's number can be re-derived, an implementer
should re-derive it before building, not after.

**Seen before.** ah-k6i.6, ah-5pp — as above, the plan being wrong in a way only re-checking finds.
