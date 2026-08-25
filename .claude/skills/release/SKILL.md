---
name: release
description: Cut a release of Atlantis HUD, write its notes while the workflow builds, publish them to the GitHub release, and commit the file. Use when the navigator asks for a release, or asks what would go out in one.
---

# Cutting a release of Atlantis HUD

This is the whole of a release, in one document: the checks before it, the command that cuts it, the
notes written while it builds, the upload that puts those notes in front of a player, and the commit
that keeps them.

**Any session can load this.** Cerebro is the usual caller, but nothing here is about the fleet —
there are no state files, no phases and no claims in it. If you are Cerebro, keep writing your own
state as your agent definition tells you to; this document does not know or care.

**A release is entirely on request.** There is no schedule, no threshold of shipped beads, and no
such thing as a release you thought was due.

**Why the order matters, and why it is worth a document at all.** The notes are written *while the
Release workflow builds*, which is several minutes of otherwise dead time — and the upload in step 5
has never been written down anywhere. It has always happened, from memory, because one person
remembered to do it. An undocumented step survives exactly as long as the person who remembers it.

## The six steps

1. A clean and current main, in the primary checkout.
2. Ask which bump, then run the release command.
3. The tag push starts the Release workflow. Start watching it.
4. **While it builds**, write the notes.
5. When the workflow finishes, publish the notes to the GitHub release.
6. Commit the notes file to main.

---

## 1. A clean and up-to-date main

Run these in the **primary checkout** — the repository root, never `.cerebro/worktrees/*`. Check
`pwd` first: a shell keeps its directory between commands, and one `cd` into an implementer's
worktree sends every later git command there, where a release would be cut from somebody's feature
branch.

```bash
# The primary checkout is the first entry of `git worktree list`, whichever worktree you are in.
cd "$(git worktree list --porcelain | head -1 | cut -d' ' -f2)"
pwd                                              # confirm it, and that it is not a worktree
git rev-parse --abbrev-ref HEAD                  # must be main
git status --porcelain                           # must be empty
git fetch origin main
git rev-list --count main..origin/main           # behind: 0, or pull below
git rev-list --count origin/main..main           # ahead: must be 0
```

Then, and only then:

```bash
git pull --ff-only origin main    # if behind; --ff-only, never a merge commit
```

What each failure means, and what you do about it:

- **Behind origin** — `git pull --ff-only`. Ordinary: implementers merge PRs all day. `--ff-only`
  because a merge commit made on main here is a commit nobody reviewed.
- **Ahead of origin** — stop and ask. A local commit on main that has never been pushed is either
  somebody's mistake or work in progress, and tagging it ships something no one has seen. Never
  push it yourself to make the check pass.
- **A dirty tree** — stop and ask, and say exactly which files. **Never commit, stash, checkout or
  clean anything to get past this.** Those edits are somebody's, and the most likely somebody is the
  navigator in another terminal. A stash you make here is a stash they will not think to look for.
- **Not on main** — stop and ask. Do not switch branches: main may be checked out in a worktree, and
  in the primary checkout being on something else is a fact worth reporting, not one to paper over.

**Name what is merged but unverified before you cut anything**, and let the navigator decide with
that in front of them. Verification does not gate the release; naming what has not been checked is
what makes that an informed choice rather than a blind one.

## 2. Ask which bump, then run it

If the navigator said "cut a release" without saying which, ask — the three bumps are not
interchangeable and the answer is one question:

- **maintenance** — `x.y.Z+1`, a fix release off what is already shipped.
- **minor** — `x.Y+1.0`, new user-visible behaviour.
- **major** — `X+1.0.0`, a break in what a player can expect, or in data they already have.

```bash
pnpm run release <maintenance|minor|major>
```

**`scripts/release.ts` owns everything from here to the tag: the version arithmetic, the full gate,
both manifests, the commit, the push to main and the push of the tag.** Do not restate any of it in
this document and do not do any of it by hand — a second copy of the release arithmetic is exactly
the drift this skill exists to prevent.

It runs the project's full gate before it touches either manifest, so **expect several minutes** and
give it a generous timeout. Nothing is written until every check passes, so a gate failure leaves the
version untouched and the repository exactly as it was.

Relay what it says, and **do not fix what it finds**. A failing gate is a bug on main, which is a
bead, which is the navigator's call and then an implementer's work. Report the failing check and its
output; do not edit code to get the release out.

If the script fails *after* it has started pushing, it prints the exact recovery commands for the
half-finished state it left. Give those to the navigator verbatim and let them decide — a stranded
release is a state to report, not one to improvise your way out of.

Ask it what else it offers rather than assuming; if it has a rehearsal mode, that is a fine thing to
offer when the navigator asks for one and never something to reach for unprompted.

## 3. Watch the workflow

The tag push starts the **Release** workflow, which builds the macOS, Linux, Windows and web bundles
and creates the GitHub release. That is minutes more:

```bash
gh run watch "$(gh run list --workflow Release --limit 1 --json databaseId --jq '.[0].databaseId')"
```

Two things to say out loud once the version is cut: **the version that went out**, and that **a PR
merging between your pull and the tag is simply not in the release**. The fleet does not stop for
this and should not — a release is a snapshot of main at a moment, and an implementer who merges
thirty seconds later has not done anything wrong.

## 4. While it builds: write the notes

This is the step the wait is for. The notes live at **`docs/releases/v<version>.md`**;
`docs/releases/v0.11.0.md` and `docs/releases/v0.11.1.md` are the worked examples, and reading one
before you start is the fastest way into the voice.

You turn a range of merged work into a short page a person who does not read code can act on. The
audience is **players** — whoever plays Atlantis using this — not the fleet that built it: they want
to know what they can now do that they could not, and what has stopped going wrong.

**Everything technical is noise here.** No bead ids, no PR numbers, no file or module names, no
"refactored", "migrated", "wasm", "submodule". If a sentence would only make sense to somebody who
has read the repository, it does not belong on the page.

### The range

Two most recent tags, newest first:

```bash
git fetch --tags origin
git tag --sort=-creatordate | head -2      # e.g. v0.11.1 then v0.11.0
```

The notes cover `<previous>..<latest>`. If the navigator names a different pair, use theirs — and if
the latest tag is not the release they meant, ask rather than guessing; a release cut minutes ago and
one cut last week look identical from here.

### The beads that shipped

Every commit in the range carries its bead id in the subject — `feat(ah-3bl): …`, `fix(ah-p31): …` —
so the range gives you the ids, and `bd` gives you what they were for:

```bash
git log --format='%s' v0.11.0..v0.11.1 \
  | grep -oE '\(([a-z]+-[a-z0-9.]+)\)' | tr -d '()' | sort -u
```

A bead usually has several commits and sometimes none of its own — a bead delivered inside another
bead's PR leaves no subject of its own, and is picked up below when you read what actually changed.

### Dropping what a player cannot see

**A bead belongs in the notes only if it changed the application.** The test is the one Psylocke
uses, and it is about paths rather than judgement:

```bash
git show --stat --format= <sha>     # for each commit of the bead
```

**Application-touching iff some changed path is one of this project's application paths** — which
here means `packages/`, `crates/` and `apps/`. Everything else — `.claude/`, `docs/`, `scripts/`,
`tests/`, `.github/`, config — is the fleet talking to itself. A new agent, a rewritten skill, a CI
fix and a test-only change are all invisible to a player, however much work they were.

Two corroborations, both cheap:

- a bead already carrying `verification:not-needed` was ruled out by Psylocke on this same test;
- a bead carrying `verification:passed` has been watched working by the navigator, which is the
  strongest evidence it is worth a line.

Then drop one more class by reading rather than by path: **work that is invisible in practice**. A
fix to a feature that never shipped, a change behind a flag nobody can turn on, a correction to
something released in this same range — the player never experienced the problem, so telling them it
is fixed describes a bug they never had.

If dropping leaves nothing, say so plainly. A release that moved only the harness is a real thing and
the honest note is one sentence: *this release contains no changes a player will notice.*

### What each surviving bead actually did

Read three things, in this order, and stop when you can say what changed for the player:

- the bead's **description** — what was wrong or missing, usually in the reporter's own terms;
- its **acceptance criteria** — what had to be true afterwards, which is the outcome stated for you;
- the plan's **User-facing decisions**, in `design` — where the navigator settled how it would look
  and behave, and therefore what a player will actually meet.

```bash
bd show <id> --json | jq -r '.[0] | .title, .description, .acceptance_criteria, .design'
```

`bd show --json` answers with an **array**, even for one id — `.title` on it fails with "Cannot
index array with string", which is a confusing way to learn this.

**A bead from a GitHub issue is worth extra care.** Its `external_ref` is a `gh-<n>`, which means a
real person hit it and wrote it up — they are likely to read these notes looking for their own
report, and they will recognise a description of the thing they saw. Read the thread if the bead is
thin.

### Writing it

**Group by the part of the app, not by the kind of change.** A player thinks "what is different
about the map", not "what was a bug and what was a feature" — so a fix to the map belongs beside a
new map feature, and the reader meets everything about one surface at once.

```markdown
What's new for you in Atlantis HUD (<version>)
=============================================

## Map

- Right-click a hex to instantly jump the map to it, without changing what you have selected
- Province borders are bolder and easier to see at any zoom level

## Writing orders

- You can now import orders straight into the app instead of retyping them
- Cleaner spacing in the orders editor, with errors marked more clearly
```

**The areas come from the work, not from a fixed list.** Name them the way a player would say where
they were when they met it. What v0.7.0 wanted: Map, Layout, Writing orders, Turn history, Fleet
movement, Saving and exporting (desktop). A release about something else will want other names.

Order the areas by how much of the release lands in each, with two exceptions: what most players
touch daily goes near the top whatever its size, and anything that applies to only one platform goes
last with the platform in the heading.

**Rules that keep it readable:**

- **One line per item, no more.** No bold lead-in, no second sentence explaining the first. If a line
  needs a caveat to be true, the caveat is part of the line or the item is two items.
- **Address them directly.** "You can now plan sea routes…", "Right-click a hex to…". Not "the
  application supports" and not "we have added".
- **Describe the outcome, not the work.** "The hex you've selected is now much easier to spot, with a
  clear glowing ring" — not "added a double ring and pulse animation to the selection overlay".
- **A fix names the symptom they had.** "Fixed a bug where units from a previous turn could
  incorrectly still appear as if they were current" — they remember that happening. "Fixed a
  stale-state bug" tells them nothing.
- **Their words, not the codebase's.** Hexes, units, orders, turns, provinces and factions are the
  game's language and belong. Name a thing on screen the way the screen names it. Components,
  stores, crates and bundles never appear.
- **No counts of work**, no bead ids, no PR numbers, no version numbers of dependencies.
- **Nothing conditional.** If you cannot tell whether something is user-visible, ask the navigator
  rather than hedging — "may improve performance in some cases" tells a reader nothing and costs
  their trust.

**Err towards including a capability.** Something stored for later use, or a foundation a player
will meet next release, is worth a line if it can be said in their terms — "older reports are kept
properly for later reference" is useful; the increment of a feature that shipped complete in the
same release is not.

### Before you hand it over

Read it once as somebody who has never seen this repository, and cut every line that only makes
sense with it open. Then check the two failure modes that survive that reading:

- **A line nobody can act on.** If a reader cannot tell whether it affects them, it needs the "when
  it helps" half or it needs cutting.
- **A fix with no symptom.** Every entry describing a fix should name something a player could have
  noticed. If you cannot state the symptom, the change was probably invisible and does not belong on
  the page at all.

Then give it to the navigator to read before it goes up.

## 5. Publish the notes to the release

**This is the step that has never been written down.** It has always happened, because somebody
remembered; that is why this document exists for something that has always worked.

Wait for the workflow from step 3 to finish — the release object has to exist before you can edit it
— then:

```bash
gh release edit v<version> --notes-file docs/releases/v<version>.md
```

Until this runs, the release is public carrying only the installation instructions that
`.github/workflows/release.yml` sets as the release body. That window is deliberate: installation
instructions read as *the notes are not written yet*, whereas a machine-generated commit list reads
as *this is the changelog*, and a list of bead ids and refactorings is the wrong thing to show a
player. It is why this step is not optional and not "later" — do it as soon as the workflow is
green.

**`--notes-file` replaces the entire body**, so what is in `docs/releases/v<version>.md` is exactly
what a player sees — including replacing those installation instructions, which is what has happened
on every release so far. Check the result before you move on:

```bash
gh release view v<version> --json body -q .body | head -20
```

## 6. Commit the notes file

The uploaded body is what a player reads; the file is the durable record, and both are required.
Commit it to main from the primary checkout:

```bash
git add docs/releases/v<version>.md
git commit -m "docs: release notes for v<version>"
git push origin main
```

Say the version that went out, and that the notes are both published and committed.

Moira will notice the tag on her next pass and move every bead it contains to `RELEASED`, closing
the linked issues. That is hers; you do not comment on issues and you do not close beads for it.
