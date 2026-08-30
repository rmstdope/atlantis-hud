---
name: atlantis-verification
description: Prepare a manual verification of Atlantis HUD before a person's time is asked for — pick the shell, pick or build a fixture and prove it reaches the case, and write the numbered script the navigator follows. Use when a change is to be verified by hand.
---

# Preparing a verification before the navigator's time is asked for

Manual verification is the one point in this fleet where a person actually looks at the running
application. Their minutes start when they say yes, not before — everything below happens first, so
the first thing they see is a running shell and a script that already works.

## What the project already declares, and what this skill must never repeat

`.claude/cerebro/scripts/project-conf` already carries the facts a shared harness can know, and this
skill never restates them:

- `launch_targets`, and `launch_<name>` / `launch_<name>_port` for each — the command that starts a
  shell and the port it serves on.
- `prewarm` — the build to run once, ahead of time, so the first launch is not a cold build.
- `fixtures_doc` — the file describing this project's committed fixtures
  (`tests/fixtures/reports/README.md`).

`project-conf`'s own header gives the reason: **a duplicate is a second source of truth that will
drift.** Read the keys, don't copy their values into this file or into a bead.

The tree you verify in, the sha you verify at, the free-port check before a server starts, and the
passed/passed-with-a-follow-up/failed verdict machinery are all `agents/verifier.md`'s. This skill
carries only what that shared file cannot know: which shell is worth the navigator's minutes for a
change in *this* project, how a fixture is chosen and proved before anyone is called, and the shape
a script takes when a person reads it.

## Which shell, and why it is usually the web one

**Default to the web shell.** Launch the desktop shell instead only when one of these is true, so
the choice is a lookup rather than a judgement call:

- the diff touches `apps/desktop/`, `crates/core-tauri/`, or `crates/core-persistence/`;
- the change concerns file-system access, a native dialog, or the Tauri IPC adapter;
- the bead's own plan names the desktop shell.

Otherwise, web. Both shells run the same React application, and the desktop build is a cargo/Tauri
build spent out of the navigator's patience for no difference they would see. (No duration is quoted
here on purpose — nothing in this repository states one, only that it is slower.)

## The fixture: pick one, prove it, or build a minimal one

Three steps, in order.

1. **Pick.** Read `tests/fixtures/reports/README.md` — its "good for" column is written for exactly
   this — and choose the committed report closest to the case the bead changed.

2. **Prove it, before the navigator is asked for anything.** Write a throwaway Rust integration
   test into your own verification worktree and run it — never commit it:

   ```rust
   // <verification worktree>/crates/core/tests/verify_fixture.rs — throwaway, never committed
   use atlantis_hud_core::report::parse_report_full;

   #[test]
   fn the_fixture_reaches_the_case() {
       let text = std::fs::read_to_string("/absolute/path/to/the.rep").unwrap();
       let parsed = parse_report_full(&text);
       // assert the precondition the first decisive script step depends on
   }
   ```

   `pub fn parse_report_full(source: &str) -> ParsedReport` lives at
   `crates/core/src/report/mod.rs`; the crate is `atlantis-hud-core`, and its integration tests live
   in `crates/core/tests/`. Run it with:

   ```bash
   cargo test -p atlantis-hud-core --test verify_fixture -- --nocapture
   ```

   `std::fs::read_to_string` on an absolute path is deliberate: it reads a committed fixture and a
   scratch-only one identically, which is what lets a hand-made fixture (below) stay out of
   `crates/fixtures/src/lib.rs` and `packages/fixtures/src/index.ts` — both carry a lockstep test
   that fails when `tests/fixtures/reports/` and the names in that module disagree, so reaching for
   a named fixture constant instead would force every made fixture to be committed, and the
   navigator ruled against that. Quote what the probe printed in the briefing.

**For a batch, scan rather than pick.** The same probe harness answers "which committed hex serves
   all of these beads at once" — walk every fixture, classify each region with the shipped ruleset,
   and score hexes by how many of the batch's preconditions they hold (a market that sells
   something, a market that wants something an own unit holds, an own unit with silver, a tax base,
   and so on). Print the top few and choose from them. It is worth the few minutes: it is what turns
   five launches into one, and it tells you honestly when no hex serves the whole batch — in which
   case **drop a bead from the batch rather than trim a fixture to fit**.

3. **Build a minimal one, only when nothing committed reaches the case.** Trim a copy of the nearest
   committed report down to the smallest thing that reaches it, write it to
   `.cerebro/scratch/<bead>-<slug>.rep`, and prove it with the same probe above. Trim rather than
   write from the grammar: a trimmed report is real syntax throughout, so whole classes of
   hand-written syntax error simply cannot occur. **Never commit it** — no `crates/fixtures` entry,
   no `packages/fixtures` entry, no README row, no PR. The navigator decided this: it is what keeps
   the verifying role a role that commits no code, and a made fixture lives only in
   `.cerebro/scratch/`, which `.gitignore` already ignores and which `prepare-worktree` resets away
   on the tree's next use.

When a fixture was made rather than picked, the page must say so — see Q7 under *The script the
navigator reads*.

## One sitting, several beads

A pass may prepare **one bead or a batch of four to six**, and a batch is often the better use of the
navigator's time. Most beads in this project are the same gesture — type one order, read two cells —
so once a shell is up and a report imported, the marginal cost of another bead is a step or two
rather than a whole launch. Two batches run this way on 2026-08-28 settled six beads between them,
one of which failed.

**What makes a set of beads a batch**, all three, not two of them:

- **One fixture and one hex serve every bead in it**, proved together before the navigator is asked
  — see the probe below, which scans for such a hex rather than assuming one.
- **They share a mental model.** The market columns (`BUY`/`SELL` against Silver and Items) are one;
  the Problems panel and its findings are another. Mixing them makes the navigator change gear
  mid-sitting, which is where attention goes.
- **Four to six.** This is the real limit and it is not about logistics. The whole point of the role
  is that a person actually looks; somewhere past the sixth "type this, read that cell" a sitting
  becomes a rubber stamp, and twelve verdicts of which four were examined is worse than four honest
  ones. **Never batch a whole family because it happens to share a fixture.**

**A verdict is still per bead** — passed · passed with a follow-up · failed, one each — because a
reopen is per bead. Take them at the end, bead by bead, and **ask rather than infer**: "mostly
passed" is not a verdict for any particular bead, and a failure reopens at P0, so the one thing a
batch must never do is let a vague answer stand in for five specific ones.

**The page carries one section per bead**, each headed with the bead's id, priority and title and a
sentence on what it changed, and the steps numbered continuously through the whole sitting so the
navigator never loses their place. Everything else about the page — the title, the subtitle, the
facts block, the made-data block, the bounded exploration at the end — is written once for the
sitting rather than once per bead. The file is `.cerebro/scratch/verify-<slug>.html`, named for the
batch (`verify-market-columns.html`) rather than for any one bead in it.

**State bleed is the batch's own failure mode**, and it has one countermeasure: a line above step 1,
in its own block, telling the navigator to delete the previous order before typing the next, and
every section written so it begins from an empty orders box. An order left behind from an earlier
bead changes what the next one shows, and the resulting verdict is confidently wrong.

**A failure mid-batch does not stop the sitting.** The later verdicts are still verdicts against the
sha you launched, and the reopened bead comes back round on a later pass anyway. Record them all,
then run the reopen procedure once the sitting is over.

## The script the navigator reads

The script is a self-contained HTML page written to `.cerebro/scratch/verify-<id>.html` — or
`verify-<slug>.html` when it covers a batch, see *One sitting, several beads* above —
**overwritten** each time that bead is verified (a bookmarked tab then reloads to the current
script, and nothing piles up as `verify-<id>-2.html`, `-3.html`, …). The terminal handoff (below)
carries a `file://` link to it — never the whole script printed in the terminal, where it scrolls
away behind the session's own chatter.

The picture of what a prepared verification looks like, chosen over three rounds of iteration with
the navigator, is committed at `docs/ui/ah-38qc-verification-script.html` (merged in #733) — read it
before writing your first page.

**Required structure**, each of these a requirement and not a suggestion:

1. A title that is a sentence about what is being verified, not the bead's title.
2. A subtitle line: `<id> · origin/main <short sha> · prepared <time>`.
3. The made-data block (Q7 below), **only** when the fixture was made rather than picked.
4. A facts block: which shell and its URL, the report to import, what was checked in advance, and
   what changed.
5. Numbered steps, each a checkbox, an action, and the thing to look for. A step that can fail
   decisively also carries what a failure looks like and what it would mean.
6. The exploration section (*Where this is most likely to be wrong*, below).

**Step wording is yours, and names controls as they are actually labelled** — read the label out of
the component rather than recall it. The mockup's own example uses **Import**, the button's real
label (`packages/shared/src/workspace/AppHeader.tsx`, `{busy ? importingLabel(progress) : "Import"}`).

**Q7 — a hand-made fixture announces itself** with a block above step 1, not a line among the facts
and not a per-step tag. The wording pattern, with the parenthesised parts filled in per
verification:

> **The data here was made for this check.** No committed report has *(the shape that was
> missing)*, so I trimmed *(the report it came from)* down to *(what is left)*. It parses clean
> *(counts)* and *(the precondition)* — but it is not real game data, so a number that looks strange
> may be my fixture rather than the app.

The verdict options (passed · passed with a follow-up · failed) stay in the terminal only, never
repeated on the page: the page is a static file with no agent behind it, and ending it with what
looks like a prompt invites a click that does nothing.

## Where this is most likely to be wrong: bounded exploration

Exploratory verification is allowed, and often where a defect is actually found —
`docs/retrospectives/ah-0w7w-reopened.md` records the navigator going off-script and finding a real
gap that became `ah-brgo`. But it is guided, not open-ended: name two or three specific things to
try, each with what would count as wrong, so it does not become the whole session.

Heading and bounding sentence, **verbatim**:

> **Where this is most likely to be wrong**
>
> *(two or three specific things to try, each with what would count as wrong)*
>
> These three are where a change like this usually breaks. Past them the returns drop off fast —
> anything else odd is a new bead, not this verdict.

## The handoff

Four lines, verbatim shape, and **never `open` the page for the navigator** — the link is clickable,
and opening it for them steals focus every pass whether or not they said yes to looking now:

```
verifying <id> at origin/main <short sha>, fetched <time>.
The <name> shell is up at <url> with the fixture already prepared.

The script — open this first:
  file:///<absolute path>/.cerebro/scratch/verify-<id>.html

<n> steps, about <n> minutes. Tell me when you have a verdict:
  passed · passed with a follow-up · failed
```

**A batch's handoff says so, and names every bead in it**, so the navigator knows what they are
committing to before they start rather than discovering it on the page:

```
verifying <n> beads at origin/main <short sha>, fetched <time>.
The <name> shell is up at <url> with the fixture already prepared.

The script — open this first:
  file:///<absolute path>/.cerebro/scratch/verify-<slug>.html

<n> steps, about <n> minutes — longer than a single bead. Tell me the verdicts bead by bead:
  <id> · <id> · <id> — each passed · passed with a follow-up · failed
```

Quote the minutes honestly. A batch of five is a quarter of an hour, and saying "about five minutes"
of one buys a yes that the sitting then spends.

The sha is visible here without a click on purpose — two retrospectives (`ah-m9q.2.md`,
`ah-wxk.1-verifier.md`) turn on exactly that fact, so it is not left to a click into the page.

## When the build fails

**Never hand over a broken application, and never render a verdict against one.** Say what failed,
in which tree, at which sha, with the error text; file nothing, change nothing, and leave the bead
`verification:pending`. This is one of the two states that never becomes a page — it reaches the
navigator in the terminal before any link is written, because a broken build is not a script anyone
could follow.

Two build traps this project has already paid for (`.cerebro/traps.md`), worth knowing before you
report a failure as a mystery:

- **The smoke suite rebuilds the web bundle with the service worker disabled.** A PWA run started
  right after it fails with timeouts that look like a broken service worker, but nothing is actually
  broken — rebuild for the shell you are about to run, not whatever the smoke suite left behind.
- **`vite preview` without `--strictPort` silently serves somebody else's bundle.** A green-looking
  launch on the wrong build looks exactly like a passed verification of the wrong thing. Run the
  launch command exactly as `project-conf` declares it — it already carries the right flags.
