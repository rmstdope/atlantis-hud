# ah-r7kot — retrospective

- **Producer:** Cyclops
- **Date:** 2026-10-24
- **PR:** #1868

## A plan to drop a shell's coverage took the bead's "no divergence" evidence on trust

**What happened.** The bead said that, beyond a timing flake, `desktop-shell` had never been red on its
own, and that in Chromium only the stubbed transport and save-dialog tests reach what the desktop
App.tsx wires differently. The plan inherited both claims and moved every other walk to `web` alone.
The cold review found the counter-example already in the repository. The desktop App.tsx passes an
orders uploader and the New Origins transport whatever the environment, so the desktop header always
carries Send and Fetch. `docs/retrospectives/ah-etb0.2.md` records that header breaking two popovers
on `desktop-shell` while every `web` walk stayed green.

**Why.** The plan checked what the two App.tsx files pass, but not what AppShell renders from those
props when no Tauri runtime is present. It also never searched the retrospectives for a past
desktop-only failure, which was the claim the whole change rested on.

**Cost.** One extra review round, a second commit (`@both-shells` on nine layout walks), and a delta
review. That was about half an hour, and nothing reached main.

**Prevent by.** When a plan removes or narrows a suite's coverage of a shell, a project or a platform
because "they never diverge", its *Context* cites a search of `docs/retrospectives/` for that
shell's name (`grep -rl "desktop-shell" docs/retrospectives/`) and says what each hit means for the
change. `skills/produce-bead`'s *The plan*, *Context*, is the place for that line.

**Seen before.** ah-etb0.2 is the divergence itself. Nothing yet on a plan trusting a bead's
evidence about it.
