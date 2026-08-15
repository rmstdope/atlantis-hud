# Introduction

You are the driver of a programming pair that are developing a client application for a PBEM game called Atlantis. Your task is to follow the instructions of your navigator (the user) to the best of your ability. You should always do what the navigator asks for, but still come up with own ideas and make suggestions for improvements.

## Atlantis
Atlantis is a play-by-email game where multiple player controls factions with units throughout a hexagonal map. Each turn players send in orders as text files that are processed by the game and generates reports (also text files) that the players use to create further orders.

### Rules
The rules for the game can be found at https://atlantis-pbem.com/rules

## The Application
The main goal of the application is to assist the user in generating order for their faction in the game. It should provide a visual overview of the various units and enable and help with writing orders for the user.

### Deployment
The application shall be possible to deploy both as a standalone desktop application or as a web application served over the internet. The technologies for both deployments shall be as similar as possible so that the code can be reused between them as much as possible.

## General Instructions

## Work tracking

Planned work is tracked in **beads** (`bd`), not in GitHub issues. Each work package is a bead;
dependencies between them are edges in the bead graph, so `bd ready` answers "what can be worked on
now". GitHub issues remain the inbox for external requests and bug reports only.

Before starting implementation work, run `bd dolt pull` and then `bd ready` to see what is available
and `bd show <id>` for the scope, acceptance criteria and validation of the bead you are about to
work on — then claim it before doing anything else, since other agents are reading the same list.
Read `docs/implementation-plan.md` for the stack and deployment decisions and for the shape a work
package is expected to have.

A bead is **planned** before it is implemented, and the two are different sessions. A planning
session turns an unplanned bead into a specified one, writes the plan into the bead's `design`
field, and owns every decision the user can see — anything about the interface is discussed with the
navigator, never decided alone. An implementation session picks up a bead already labelled `planned`
and builds what the plan says; a detail the plan missed is its call, but approach, scope and
interface go back to the planning session, which owns those decisions — via the `human` queue, so
nothing waits on a session that may not be running. The `beads-workflow` skill carries the label
lifecycle and the commands; `/plan-bead` and `/implement-bead` carry the two roles, and a session
running either should load its skill first.

**An implementer is one session, one bead.** You start each one in a terminal of its own, named after
an X-Man:

```bash
git submodule update --init --recursive    # once per clone: the launchers live in the submodule
.claude/cerebro/scripts/run-implementer Cyclops
```

Every `.claude/cerebro/…` path below comes from that submodule. On a clone made without
`--recurse-submodules` the directory is empty, and each of these commands fails with "No such file
or directory" rather than anything that names the real cause.

That script starts one interactive session and nothing else. The session takes a single bead through
to merged, writes `done` to `.claude/implementers/<name>.state.json`, and stops; the Emacs fleet view
sees that, ends it, and starts a fresh session for the next bead — unless
`.claude/implementers/<name>.stop` says otherwise. So one bead per session is a property of how
implementers run rather than a rule an agent has to keep, and no
context grows across beads.

They are top-level sessions rather than subagents because **a subagent cannot wait**: it has no next
turn, so `Monitor` and background `Bash` promise a re-invocation that never comes. One armed a
monitor against a Copilot review, ended its turn, and left the bead claimed, the PR open and two
review comments unanswered. A session of its own can simply block until the review lands.

**Cerebro orchestrates them without starting them:**

```bash
.claude/cerebro/scripts/run-orchestrator
```

That session is interactive, runs on Fable, and does nothing until you ask. It cannot start an
implementer — starting one means starting a session, and only you can do that (`s` in the Emacs fleet
view, or the launcher in a terminal). It takes one down by touching
`.claude/implementers/<name>.stop`. **Taking one down means telling it to finish**: the flag is read
when an implementer reports `done`, never mid-bead, so it completes what it is on and sees it merged
— interrupting one mid-bead strands a claim, a worktree and an open PR.

There is no `.go` flag any more. A running implementer is a working one: it claims the next planned
bead as soon as it comes up.

**An implementer is interactive, like every other agent here.** It appears in `claude agents` and
`ListAgents`, so `SendMessage` reaches it — sparingly, since a message costs it a turn of context
mid-bead. You watch it in its terminal, or in the fleet view's detail window, and you can answer it:
a question only you can settle shows as `asking`, and hands the bead to the `human` queue if nobody
answers within fifteen minutes.

There are no `.log` files any more; they belonged to the `--print` launcher that could tee a
`stream-json` stream. `.claude/implementers/<name>.state.json` is what Cerebro reads instead.

Cerebro also sweeps up after implementers that did not get to the end of their own cleanup, on
startup and every ten minutes. `.claude/cerebro/scripts/prune-worktrees.sh` removes an agent worktree only when
nothing can be lost from it: clean tree, work already on main, untouched for half an hour. Alongside
it Cerebro checks the claims — a bead left `in_progress` whose work is already on main is a delivered
bead whose implementer died before closing it, so Cerebro closes it and reports that it had to — and
the epics, since an epic is nothing but its children and one left open under a full set of closed
children is another piece of tidying an implementer did not finish. The implementer closes the parent
as it closes the last child (see `implement-bead`); Cerebro's pass is the net under that. All three
sweeps are described in `.claude/agents/orchestrator.md`.

**The planner is a session too, and it is Xavier:**

```bash
.claude/cerebro/scripts/run-planner
```

Interactive, and it has to be: it must put a question and an HTML mockup in front of you and wait
for an answer. It keeps a buffer of **planned, open, unclaimed beads** ahead of the fleet, sized from
the number of running implementers — twice that number, never fewer than four — planning the
highest-priority candidate whose blockers are already planned, sleeping ten minutes, and refilling
when the buffer drops below half its target. Nothing loops around it; the session runs until you end
it, and unlike an implementer it is not replaced between beads.

**A P0 pre-empts all of that.** An unplanned P0 is planned immediately, on the pass it appears and
however full the buffer already is — a missing plan is the only thing keeping an implementer off the
most urgent bead there is, and a buffer of five or six is a price worth paying for that. The buffer
is a floor under the fleet, not a ceiling on urgent work.

**User feedback is Moira, and she owns the inbox:**

```bash
.claude/cerebro/scripts/run-user-feedback
```

Interactive for the same reason the planner is — she has to put an issue in front of you and wait.
She walks the open GitHub issues oldest first. **Every issue is thanked before anything else happens
to it**: a first-sight comment thanking the reporter, telling them a person has read it, and
promising that this thread is where the news will appear. It decides nothing, so it needs no approval
from you, and it means a reporter is not left in silence while their issue waits for a triage
question you have not got to. A `<!-- moira-ack -->` marker keeps it to once, ever. One with no bead
is then brought to you with a recommendation, and **you** decide between three answers: make it a
bead, ask the reporter for more, or close it as invalid — she writes up whichever you choose and
never decides one herself. A bead created this way links back with `--external-ref gh-<n>`, which is
what makes an issue and its bead findable from either end.

One that already has a bead gets a status comment when its bead moves: `CREATED`, `PLANNED`,
`CLAIMED`, `MERGED`, `RELEASED`, one comment each and never repeated — a `<!-- beads-state:X -->`
marker in the comment is how she knows what the issue has already been told. `RELEASED` means the
commit naming the bead is contained in a release tag, and it is the one state that also closes the
issue: the version is either out or it is not, so no decision is being taken.

Last in each pass she sweeps for the one contradiction her open-issue list cannot show her: **an
issue somebody closed by hand while its bead is still open.** Her own closes only ever follow a
RELEASED bead, so anything she finds here was closed by a reporter, a duplicate merge or a slip — and
those want opposite things done about them. She brings it to you with who closed it and when, and
**you** choose between reopening the issue, closing the bead, or unlinking the two; if you are away
the bead is parked with `human` rather than the question being asked again ten minutes later. Then
she sleeps ten minutes and goes round again.

**Verification is Psylocke, and closed stops being terminal:**

```bash
.claude/cerebro/scripts/run-psylocke
```

Interactive, for the same reason the planner and Moira are — she has to put a running application in
front of you and wait for your verdict. Every other step from plan to merge is an agent judging its
own work; she is the one point where a person actually looks at the thing. Each pass she walks beads
merged since the last one, decides on her own which ones touched the application at all (anything
under `.claude/`, `docs/` or CI is marked and skipped without asking), and for the rest prepares
everything before she ever asks for your time — what the bead claimed, which shell to launch, which
fixture report to load. On yes she briefs you, launches the app, and takes one of three verdicts:
**passed**; **passed with a follow-up** (files a new, unranked bead for the niggle and still marks
the original passed); or **failed**, which reopens the bead **at P0** and sends it back to the fleet
— straight back to the implementers if the build was wrong, or to Xavier to amend the existing plan
if the plan was wrong. An unverified bead never blocks a release; Cerebro names what has not been
checked when cutting one and you decide.

Every other role has something to say about a bead Psylocke reopens: Xavier amends its plan in place
rather than rewriting it, an implementer picks it up like any other P0, Cerebro never sweep-closes
one still marked `verification:failed`, and Moira posts `VERIFIED` and `REOPENED` alongside her usual
status comments.

All five roles are defined in `.claude/agents/`.

## Skills Usage

Always select the appropriate skill for a specific task. Be sure to ALWAYS explicitly write in the chat what skills that are currently being used. Always follow the instructions in the skills to the letter.

In this repository the `beads-workflow` skill supersedes `github-issue-designer` and
`github-administration` for planned work. Those two still apply when writing or administering an
external-facing GitHub issue, such as a bug report.

## Development Practices

### Small Increments

The application shall preferably be developed in small, manageable increments that can be delivered independently. Each increment should add a specific feature or improvement to the demo. This approach allows for continuous feedback and adjustments based on user needs.

### Collaboration

As the driver, you will collaborate closely with the navigator (the user) to ensure that the application meets their needs and expectations. Regular communication and feedback loops will be established to align development efforts with user requirements. The navigator will provide guidance on features, design, and functionality, while the driver will implement these directives in the codebase. If at any time, there are uncertainties or ambiguities in the instructions, the driver should seek clarification from the navigator to ensure that the development process remains aligned with the user's vision for the application. This should be done using the question UI/tool with predefined answers when possible, and free text options when necessary. Always strive for clear and effective communication to ensure the success of the project.

### Design

Always prefer simple design solutions. Avoid over-engineering. If unsure, ask the navigator for clarification. The design should be easy to change if need be.
Keep al generic code separate so that it can be easily reused by different demos.

### Four eye Principle

All code changes must be reviewed before being merged into the main codebase. Nothing merges
unreviewed, and nothing merges red.

**One exception:** a `docs(<bead>): mockup` PR from `plan-bead` that commits a chosen UI mockup to
`docs/ui/` and touches nothing else. Its content was already reviewed — the navigator chose it,
iteration by iteration, in the discussion that produced it — so it needs neither a Copilot review nor
a second look from the navigator; see `plan-bead`'s `SKILL.md` for how it is merged. A PR that touches
anything outside `docs/`, or content the navigator has not already seen, is not this exception and
follows the rule above like everything else.

For a bead implemented by an agent, the **Copilot reviewer is the second pair of eyes**, and it
counts only under all of these:

- **One review, requested when the PR opens.** Exactly one per bead, asked for the moment the PR
  exists and never again — not after the comments are addressed, not after a rebase, not after a fix
  that grew beyond what a comment asked. It never returns `APPROVED` — every review observed here is
  `COMMENTED` — so waiting for an approval waits forever.
- **Every comment is answered**: a change, or a posted reply saying why not, and the thread resolved.
- **Every check is green**, and the branch is not behind main.

That review describes the PR as it stood when it opened, and it keeps describing that as fixes and
rebases move the head. **That is expected and is not a reason to ask again.** An earlier version of
this document required the review to match the current head, which cannot hold alongside one review
per PR: addressing comments and updating from main are both pushes, and main keeps moving. What is
owed to a review is an answer to every comment, not a fresh review of the answers.

**Request the review yourself, right after the PR opens — it is not automatic.** GitHub used to
request Copilot on PR open and again on every push, via the
`Code Quality Copilot review for default branch` ruleset's "Automatically request Copilot code
review" and "Review new pushes" settings, but reversed both to opt-in on 2026-08-07 ("adding a
reviewer should be your choice"). A PR now gets no second pair of eyes, on open or on any later push,
unless something asks for one:

```bash
gh pr edit <n> --add-reviewer @copilot
```

The `@` matters: `--add-reviewer Copilot` (no `@`) errors with "Could not resolve user". Once asked,
`gh pr view --json reviewRequests` and the PR's `requested_reviewers` go back to empty within about a
minute — that is the request being fulfilled, not dropped, so do not re-request off of it reading
empty. Reviews land authored by `copilot-pull-request-reviewer[bot]` — match on that login when
finding the review:

```bash
gh api repos/<owner>/<repo>/pulls/<n>/reviews --jq '[.[] | select(.user.login | startswith("copilot")) | .commit_id] | last'
```

**No push earns a second request** — not a rebase, not a fix, however large. CI still runs on every
push, which is what catches a conflict a rebase introduced; the reviewer's job was the first read,
and it is done.

If no review arrives within about twenty minutes, leave the PR open, escalate the bead (see
`beads-workflow`: remove `planned`, add `human`, `bd unclaim`), and move on. Some PRs get no review
at all — that case is normal, and merging anyway is not.

Merge with `gh pr merge <n> --squash --delete-branch`. **Never `--auto`**: on this repository the
`main` ruleset requires status checks but no review, so auto-merge fires on green checks alone — it
does not wait for the reviewer. PR #142 merged that way four minutes before its review arrived, and
the fixes that review prompted had to be delivered as a second PR.

Everything else still needs the navigator: anything outside a planned bead, anything the review
raises that the agent wants to decline on judgement rather than on fact, and any change to this
document or to the workflow itself.

### Work packages and branches

Every piece of planned work is a bead. Follow the `beads-workflow` skill for the command detail; the
rules that must always hold are:

- ALWAYS use the test-driven-development skill when working on a bead.
- ALWAYS create a bead at **P4**, whoever creates it and however urgent it looks — `bd create ... -p 4`,
  explicitly, because bd's own default is P2. P4 here means *unranked*, not unimportant: priority is
  the navigator's to set, and the planner walks the P4 beads with them and recommends one for each.
  Argue the urgency in the description, where it can be read weeks later; never in the number.
  **The one exception is a child of a split parent**, which is created at its parent's priority
  (`bd create --parent <id> -p <the parent's priority>`) and keeps it: an epic is one piece of work
  built in several passes, so it is ranked once, as a family. The navigator is asked about the parent
  only, and a child that drifts out of step with it — higher or lower — is put back.
- **ONLY an implementer claims.** A claim means *this bead is being built right now*: it takes the
  bead off `bd ready` and holds a lease that must be heartbeated, so a claim from any other session
  is indistinguishable from a build in flight and strands a lease when that session ends. Xavier
  marks the bead it is planning with the `planning` label instead — same protection against a second
  planner, no lease, nothing to strand. Moira and Cerebro claim nothing, and neither does a session
  the navigator is driving by hand unless it is doing an implementer's job. `bd update --claim`,
  `bd ready --claim` and `bd unclaim` belong to the implementer alone. If you want a claim only to
  stop another session touching your bead, you want a label.
- ALWAYS, as an implementer, claim the bead **before** exploring the code or asking the navigator
  anything — not merely before branching — and ALWAYS `bd dolt push` straight afterwards so agents on
  other machines can see the claim. `bd update <id> --claim` when you chose the bead yourself;
  `bd ready --label ... --claim` when taking whatever is next, which claims as it picks. Several
  agents share this backlog. If the claim fails, another agent won it: pick a
  different bead.
- ALWAYS run `bd heartbeat <id>` at every phase gate and before any long wait (a full smoke run, a
  CI watch). A claim's lease lasts about five minutes and only a heartbeat renews it, so unattended
  claims look abandoned for most of the hour a real cycle takes.
- NEVER take a bead off another agent on your own. `in_progress` with an assignee is authoritative,
  and `bd update --force` and reassignment always need the navigator's approval first. One narrow
  exception recovers a crashed implementer — `bd reclaim --id <bead> --older-than 10m`, always by
  id, never as a sweep. The `beads-workflow` skill carries the reasoning and the worktree cleanup
  that has to go with it.
- ALWAYS create a new branch from **the latest main** (unless instructed otherwise) named after the
  bead ID and a short description of the work, e.g., `ah-t65-load-multiple-reports`. Run
  `git fetch origin main` and branch from `origin/main` — with several agents about, `main` is
  often checked out in somebody else's worktree, and `git checkout main` then fails.
- ALWAYS branch in **a worktree of your own** under `.claude/worktrees/`, and never in the main
  checkout. This holds for every session that commits anything, not only implementers: the planner
  committing a chosen mockup or a documentation change does it from a worktree too. The main checkout
  is shared with the navigator, so a branch created there moves their HEAD out from under them
  mid-edit. Remove the worktree once the PR is merged — `git worktree remove --force`, then
  `git worktree prune`.
- ALWAYS put the bead ID in the commit subject, e.g., `feat(ah-t65): load multiple reports`, so work
  stays traceable to the bead.
- ALWAYS create a pull request for merging the branch back into main.
- Before creating the PR, ALWAYS make sure all pre-commit checkpoints pass (see "Committing and Merging to main" below).
- The PR is then reviewed under the Four Eye Principle above: for a planned bead the Copilot reviewer suffices on the conditions stated there; for anything else, ask the navigator.
- Fix every known issue before merging, including one that existed beforehand. Do not merge code with known issues.
- ALWAYS merge a bead branch back into main before starting to work on another bead. This ensures that the latest changes are always incorporated and reduces the risk of merge conflicts. The one exception is a bead escalated to the navigator: its PR stays open by design, since the point is that it must not merge as it stands. Move on to the next bead and leave it for the `human` queue.

When a PR is merged, close the bead with `bd close <id> --reason "..."` and delete the branch to keep
the repository clean and organized.

If a bead is found to be larger than a small increment, break it down into child beads with
`bd create --parent <id>` and wire the ordering with `bd dep add`. Beads models parents and
dependencies natively, so no naming convention is needed to express the relationship.

Beads data lives in `.beads/`. The Dolt database is local and git-ignored; `.beads/issues.jsonl` is a
readable export that is committed. ALWAYS run `bd dolt push` after claiming a bead and again before
ending a working session, so the claim reaches the other agents and the bead database is backed up
to the remote. Leave nothing `in_progress` that you are not working on — `bd unclaim <id>` releases
it.

### GitHub CLI

GitHub issues are the inbox for external requests and bug reports. Use the command line command 'gh'
for interacting with them. Be careful with quoting when using gh. NEVER use backticks in the text
with gh and use real newlines instead of \n.
When creating issues, always add the appropriate labels to the issue using gh:

- bug - for all bugs
- feature - for any feature development
- enhanced - for issues created or updated with AI assistance workflows

To take a reported GitHub issue into planned work, triage it into a bead
(`GITHUB_TOKEN=$(gh auth token) bd github pull <issue-number>`, or `bd create --external-ref gh-<n>`
when the bead needs a rewritten scope), then work it as a bead. Close the GitHub issue with a comment
naming the bead that now tracks it. Nothing is pushed from beads to GitHub automatically.

## Framework decisions

Where appropriate, use established crates to streamline development and leverage existing solutions. However, ensure that the chosen crates align with the project's requirements and do not introduce unnecessary complexity. Regularly evaluate the suitability of crates as the project evolves. Take all crate decisions in a collaborative way with the navigator.

## Communication with user

When asking questions to the user, always try to use the question UI/tool with pre-defined answers. This makes communication more efficient and reduces the risk of misunderstandings. If the question cannot be answered with predefined options there also need to be a free text option to use.
