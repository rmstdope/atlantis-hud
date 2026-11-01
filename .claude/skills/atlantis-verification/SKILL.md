---
name: atlantis-verification
description: Atlantis HUD's verification skill, named by `verification_skill` in .cerebro/project.conf. Psylocke verifies merged beads herself by driving the web shell in Chrome - batching related beads into one look, reaching the case with a proved fixture, protecting the navigator's stored games, exploring near the change - and asks the navigator only for what a person must judge (a look or sound only a person can call good enough, desktop-only criteria, anything she could not reach), in one hand-off per batch, before presenting the evidence and a recommended verdict per bead.
---

# Verifying Atlantis HUD beads

This skill **extends `verify-bead`; it does not replace it.** Load `verify-bead` first and follow it,
together with `agents/verifier.md`. That covers the candidates, the fresh `origin/main` worktree, the
commit check, `verification=pending`, the port refusal, the sha in every verdict, the evidence log
with a screenshot per criterion, the report written onto the bead before asking, the recipes in
*Taking the verdict*, and the end of a pass. Where this file is more specific, this file wins. It
adds what only this project knows: which shell to look in and what is handed to the navigator, how
a fixture is chosen and proved so the look reaches the case, batching, protecting the navigator's
stored games, the human-check hand-off, exploring near the change, and the shape of the results.

The navigator's minutes are spent only on what a person must judge. Everything an agent can check
in the running web shell, you check yourself; a question that asks them to read a cell you could
have screenshotted is time taken from them for nothing.

Every question below is the verifier's three-action sandwich: `asking --bead <id> --phase verify`,
the question, then `working --bead <id> --phase verify` before anything else. In a batch, `--bead`
is the first bead of the batch.

## What the project already declares, and what this skill must never repeat

`.cerebro/cerebro/scripts/project-conf` already carries the facts a shared harness can know, and this
skill never restates them:

- `launch_targets`, and `launch_<name>` / `launch_<name>_port` for each — the command that starts a
  shell and the port it serves on.
- `prewarm` — the build to run once, ahead of time, so the first launch is not a cold build.
- `fixtures_doc` — the file describing this project's committed fixtures
  (`tests/fixtures/reports/README.md`).

`project-conf`'s own header gives the reason: **a duplicate is a second source of truth that will
drift.** Read the keys, don't copy their values into this file or into a bead.

## Which shell, and what is handed to the navigator

**You look in the web shell, always.** Both shells run the same React application, so everything
a bead changes that also shows in the web shell is yours to check there, in Chrome, even when the
bead also touches the desktop shell.

**Only what is desktop-only goes to the navigator**, as a human check (*Human checks*, below). A
criterion is desktop-only when it cannot show in a browser at all:

- it lives in `apps/desktop/`, `crates/core-tauri/` or `crates/core-persistence/` and has no web
  counterpart;
- it concerns native file-system access, a native dialog, a window, a menu, or the Tauri IPC
  adapter;
- the bead's own plan names the desktop shell for it.

For those, start the desktop shell with its declared launch command after your own web look, so it
is up when the hand-off is asked, and write the navigator's steps into the hand-off question. The
desktop shell keeps its games in files, not in the browser, so the storage snapshot below does not
cover it: say in the question that the steps run against their own desktop data. A bead whose every
criterion is desktop-only still gets its report and its hand-off; there is simply no web look.

## The fixture: pick one, prove it, or build a minimal one

Three steps, in order.

1. **Pick.** Read `tests/fixtures/reports/README.md` — its "good for" column is written for exactly
   this — and choose the committed report closest to the case the bead changed. A bead about a New
   Age game picks from the Arcanum corpus instead, Trident included — see *A New Age: Trident change
   is verified on the Arcanum reports* below.

2. **Prove it, before the look.** Write a throwaway Rust integration
   test into your own verification worktree and run it — never commit it:

   **Classify, do not merely parse.** A report that parses cleanly can still have lost every one of
   a unit's items, and `parse_report_full` alone will not tell you: `men` is only an estimate until
   `classify_units` has run against a ruleset, so a probe that stops at parsing reports healthy
   numbers for a corrupt fixture. Assert on **men and items after classification**, and compare them
   against the committed report the fixture came from.

   ```rust
   // <verification worktree>/crates/core/tests/verify_fixture.rs — throwaway, never committed
   use atlantis_hud_core::report::{classify_units, parse_report_full};
   use atlantis_hud_core::movement::rules::Ruleset;

   #[test]
   fn the_fixture_reaches_the_case() {
       // The ruleset of the game the bead is about: ruleset.json for New Origins,
       // ruleset-newage-arcanum.json or ruleset-newage-trident.json for a New Age world.
       let ruleset: Ruleset =
           serde_json::from_str(&std::fs::read_to_string("/abs/path/config/public/ruleset.json").unwrap())
               .unwrap();
       let text = std::fs::read_to_string("/absolute/path/to/the.rep").unwrap();
       let mut parsed = parse_report_full(&text);
       let classification = classify_units(&mut parsed, &ruleset);
       // Assert the precondition the first decisive check depends on — and, for a made
       // fixture, that every unit the look names still has the men and items the committed
       // report gives it. `unreadable_lines` being empty is not enough on its own.
       assert!(parsed.unreadable_lines.is_empty());
       assert!(classification.unknown_tags.is_empty());
   }
   ```

   `pub fn parse_report_full(source: &str) -> ParsedReport` lives at
   `crates/core/src/report/mod.rs`; the crate is `atlantis-hud-core`, and its integration tests live
   in `crates/core/tests/`. Cargo does not discover a test file there by itself
   (`autotests = false`, ah-dt118), so also append a throwaway target to that worktree's
   `crates/core/Cargo.toml`, never committed either, and run it with:

   ```bash
   printf '\n[[test]]\nname = "verify_fixture"\npath = "tests/verify_fixture.rs"\n' >> crates/core/Cargo.toml
   cargo test -p atlantis-hud-core --test verify_fixture -- --nocapture
   ```

   `std::fs::read_to_string` on an absolute path is deliberate: it reads a committed fixture and a
   scratch-only one identically, which is what lets a hand-made fixture (below) stay out of
   `crates/fixtures/src/lib.rs` and `packages/fixtures/src/index.ts` — both carry a lockstep test
   that fails when `tests/fixtures/reports/` and the names in that module disagree, so reaching for
   a named fixture constant instead would force every made fixture to be committed, and the
   navigator ruled against that. Quote what the probe printed in the report.

**An expected figure comes from the orders the app holds, not from the bead's orders alone.**
   Importing a report seeds its orders box from the report's own orders template, verbatim
   (`seedOrdersDocument`, `packages/shared/src/ordersDocument.ts`), so in the shell every unit the
   look never touches keeps its template orders — its `TAX`, its `WORK`, its `@claim`. A probe
   that passes `review_turn` or `preview_orders_for_remembered_report` only the bead's orders runs
   all of those units idle, and the hex's tax and work pools, and what its sharers lend, come out
   different. Verifying ah-iidht at b0ee135 on `newage-arcanum-f3-t84.rep`, a step straight after
   import asked for Praetor Cuffdower (1769)'s month-end silver: a probe given only `unit 1769`
   said 6, and the app showed 0. Measured with the helper below, the untouched template gives 0;
   clearing 1769's own `@study OBSE` alone gives 15, so his template order and his neighbours'
   both move the figure. The navigator was asked to check a number the app could never show.

   So build the probe's orders the way the shell holds them — the template, with only the units a
   step edits replaced by what their orders box holds after it — and pass that:

   ```rust
   // In the same throwaway verify_fixture.rs.
   use atlantis_hud_core::report::orders::extract_orders_template;

   /// The orders document as the shell holds it after the look's steps so far: the report's own
   /// template, with each edited unit's orders replaced by what its box holds. Comment lines stay,
   /// since an orders box's comments order nothing; a unit the template has no block for gets one
   /// before `#end`, as the shell's editor would make room for it.
   fn orders_as_the_app_holds_them(report_text: &str, edits: &[(&str, &[&str])]) -> String {
       let template = extract_orders_template(report_text)
           .map(|template| template.text)
           // No template (OPTION TEMPLATE OFF): seedOrdersDocument's empty document instead.
           .unwrap_or_else(|| {
               let faction = parse_report_full(report_text).header.faction_id.unwrap_or_default();
               format!("#atlantis {faction}\n\n#end")
           });
       let mut out: Vec<String> = Vec::new();
       let mut editing = false;
       let mut placed: Vec<&str> = Vec::new();
       for line in template.lines() {
           if line.trim() == "#end" {
               for (unit, orders) in edits.iter().filter(|(unit, _)| !placed.contains(unit)) {
                   out.push(format!("unit {unit}"));
                   out.extend(orders.iter().map(|order| (*order).to_string()));
               }
               out.push(line.to_string());
               editing = false;
               continue;
           }
           if let Some(id) = line.strip_prefix("unit ") {
               out.push(line.to_string());
               editing = false;
               if let Some((unit, orders)) = edits.iter().find(|(unit, _)| *unit == id.trim()) {
                   out.extend(orders.iter().map(|order| (*order).to_string()));
                   placed.push(unit);
                   editing = true;
               }
               continue;
           }
           if editing && !line.trim_start().starts_with(';') && !line.trim().is_empty() {
               continue; // a template order the step's box no longer holds
           }
           out.push(line.to_string());
       }
       out.join("\n") + "\n"
   }

   // Straight after import, before any step: orders_as_the_app_holds_them(&text, &[]).
   // let orders = orders_as_the_app_holds_them(&text, &[("1769", &["TRANSPORT 5 5 PIKE"])]);
   // `parsed` is the probe's own, already through classify_units: unclassified, every
   // at_month_end comes back None.
   // let review = review_turn(&parsed, &orders, Some(&ruleset), options);
   ```

   An edit is what the box holds **after** the step, so it follows what you did: a step
   that clears the box first (as a batch's state-bleed rule does) replaces the
   template's orders, and one that says *add* keeps them — list them in the edit too. Within one
   sitting a unit an earlier step edited and the look never cleared stays edited in every later
   step's probe. Quote the figure this probe printed, not the one the bead's orders give alone.

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
   hand-written syntax error simply cannot occur.

   **Edit by whole lines and whole blocks. Never delete text from inside a unit line.** The parser
   reads a report's wrapping, so shortening a line silently destroys the unit — measured on
   `g5-f21-t39.rep` unit 9498 at c2a8855e (`ah-l09a`):

   | what was done to the line | items the parser found |
   |---|---|
   | nothing — committed report | `GNOL 100, SWOR 170` |
   | `sharing, ` → nine spaces, width kept | `GNOL 100, SWOR 170` |
   | `sharing` → `holding`, same length | `GNOL 100, SWOR 170` |
   | `sharing, ` deleted, then hand-rewrapped | `GNOL 100` — one item lost |
   | `sharing, ` deleted, wrapping untouched | `[]` — **every item lost** |

   An emptied item list means `men == 0`, and nothing complains: no unreadable line, no unknown tag.
   The look opens a shell in which every unit has no people, and the pass is wasted. This
   happened on 2026-09-09, and the session's first diagnosis — a ruleset that had failed to load —
   was wrong.

   **So: to neutralise something inside a line, overwrite it with spaces of exactly the same
   length rather than removing it**, and check afterwards that every line still has its original
   width:

   ```bash
   awk 'NR==FNR{a[FNR]=$0;next}{ if (length(a[FNR])!=length($0)) print "WIDTH DIFF line " FNR }' \
     "$SRC" "$OUT"   # silence means every line kept its width
   ```

   Removing whole units, whole structures or whole region blocks is safe; it is editing *within* a
   line that is not. **Never commit it** — no `crates/fixtures` entry,
   no `packages/fixtures` entry, no README row, no PR. The navigator decided this: it is what keeps
   the verifying role a role that commits no code, and a made fixture lives only in
   `.cerebro/scratch/`, which `.gitignore` already ignores and which `prepare-worktree` resets away
   on the tree's next use.

When a fixture was made rather than picked, the report must say so — see *A hand-made fixture
announces itself* under *Present the results*.

## A New Age: Trident change is verified on the Arcanum reports

**New Age: Arcanum** and **New Age: Trident** are near-identical games (the navigator, 2026-09-13),
and the repository commits real reports for only one of them:
`tests/fixtures/reports/newage-arcanum/` — six reports for factions 3 and 5 at turns 2, 83 and 84,
each described in that directory's `README.md`. **Verify a Trident bead on those reports.** There is
no Trident corpus to pick from, and a report hand-built to look like Trident is worse than a real
Arcanum one. An Arcanum bead uses the same reports, and the same corpus's README applies to both.

Near identical is not identical, so four things keep it honest:

- **Play the report under the world the bead is about.** Create the game with the ruleset labelled
  `New Age: Trident` (`packages/shared/src/rulesets.ts`) and import the Arcanum report into it, and
  classify the probe against `config/public/ruleset-newage-trident.json` rather than
  `ruleset.json`. The report brings the map and the units; the ruleset is what the change is
  about. Anything in the report that only Arcanum's catalogue knows shows up in the probe's
  `unknown_tags` — no unit the look names may hold one.
- **Look the rule up in both worlds before writing an expected figure.** Run
  `pnpm run atlantis newage arcanum rules <anchor>` and `pnpm run atlantis newage trident rules
  <anchor>` for the rule a step turns on (and `data <term>` for an item or skill). They do differ:
  `rules/economy_maintenance` gives a leader's fee as 50 silver in Arcanum and 90 in Trident, and
  the two pages are NewAge 1.2 and 1.1 respectively. Where the rule differs, the expected figure
  comes from Trident's page. Anything the report itself printed under Arcanum's rule — last month's
  spending, say — is then not evidence for or against the change, so leave such steps out.
- **Use turns 83 and 84 for New Age mechanics.** The turn-2 reports are branded NewOrigins 8.1.0 and
  are import and history cases only, as the corpus README says.
- **Say so in the report.** One line names the report as an Arcanum report played
  under the Trident ruleset. That is a plain line, not the made-data block — the report is
  real and unedited — but it stops a number that looks Arcanum-shaped being read as the app's fault.


## The core the shell serves is checked, not assumed

The WebAssembly core is gitignored and built locally, so a shell can serve one older than the
sources it sits beside — which reopened two correct features at P0. The dev servers rebuild a stale
core before they serve a page, and this step proves it rather than trusting it: once the shell is up
and before the look begins, run from the tree the shell serves

    node scripts/ensure-wasm.mjs

and expect `wasm module is current, skipping the build`. Anything else means the core was rebuilt
under you or failed to build: reload the page once the command finishes, and if it failed, this is
*When the build fails* below, not a verdict.

## Batch beads into one look

Starting the shell, proving a fixture and importing it is the expensive part, so share it. After
the verifier's candidate lists are built, group the ordinary candidates:

- **Batch together** beads that are all in the verification tree at the same `origin/main` sha and
  share a mental model: the market columns (`BUY`/`SELL` against Silver and Items) are one; the
  Problems panel and its findings are another; the month-end silver of one unit is a third. **One
  fixture and one hex must serve every bead in it**, proved together by the batch scan above —
  when no hex serves them all, drop a bead from the batch rather than trim a fixture to fit.
- **Keep apart** a bead whose look needs a fresh game, a different ruleset, or emptied storage that
  would spoil the others' state, and a reopened `verification:failed` bead: its rebuild deserves its
  own clean look.
- **At most four beads per batch.** The question tool takes four questions per call, and the verdict
  call asks one per bead. Never batch a whole family because it happens to share a fixture.

Say each batch and its reason in one line before launching, for example "batch A: ah-x1, ah-x2,
ah-x3, all market columns on hex (12,8) of `g5-f21-t39.rep`, one look at `<short sha>`". Then, per
batch:

1. Prepare every bead (verify-bead's *Prepare*): one checklist per bead, criterion by criterion, with
   each expected figure from the probe above.
2. Launch once (verify-bead's *Launch*), check the core (above), and take the storage snapshot
   (below) before the first import.
3. Walk the beads in the order that reaches their states most cheaply, keeping a separate evidence
   log per bead. A screenshot can serve two beads, but name it in both logs.
4. **Guard against state bleed between beads**: begin each bead's checks from the orders box as its
   probe assumed — clear the order an earlier bead typed before typing the next. An order left
   behind changes what the next bead shows, and the verdict is then confidently wrong.
5. Collect every human check in the batch into **one** hand-off (below).
6. Explore once for the whole batch (below).
7. Write **one report per bead** onto that bead, then ask for the batch's verdicts in **one** call of
   the question tool, one question per bead.

A batch never merges verdicts: each bead passes or fails on its own evidence, and "mostly passed" is
not a verdict for any bead. A failure found mid-batch does not stop the look; finish the batch,
then record each bead by its own recipe.

## Protect the navigator's data

The browser is the navigator's own Chrome, and the web shell's origin (`http://localhost:<port>`)
holds every game they have loaded there: the games list and one IndexedDB database per game, with
their imported reports and order drafts, and their map views and settings in `localStorage`.
Importing a fixture, typing orders and deleting a game during the look all write to it. So
**snapshot before the first import, restore when the look is over, including after a blocker**.

`scripts/verify-storage.js` does both, and keeps the copy inside the browser so a game's values stay
exact. Read the file from the verification tree and paste its whole text, followed by the call, into
the Chrome integration's JavaScript tool, on a tab of the shell's origin:

```js
/* the whole text of scripts/verify-storage.js */
await atlantisVerifyStorage.snapshot()   // -> { databases, localStorageKeys, takenAt }
```

and when the look is over:

```js
/* the whole text of scripts/verify-storage.js */
await atlantisVerifyStorage.restore()    // -> { databases, localStorageKeys }
```

then reload every tab of the shell: a restore deletes and rebuilds the databases, and the app stops
its storage when another connection deletes one, so a tab left open shows that until it is reloaded.

Two refusals are the script protecting the data, never something to work round:

- **`snapshot()` refuses while an earlier snapshot waits** — run `await atlantisVerifyStorage.status()`
  to see when it was taken. It is a look that never restored, so it may be the navigator's real data.
  Ask them before anything else: restore it now, or keep what is there and discard it.
- **`restore()` reports a database still blocked** by another tab. Ask the navigator to close or
  reload their other tabs of the shell, then run it again; the snapshot is kept until a restore
  succeeds.

A look that needs empty storage (a first visit, an empty games list) deletes the games through the
app **after** the snapshot. Say in each report that storage was snapshotted and restored, with the
counts both calls returned.

## The look, for Atlantis HUD

On top of verify-bead's *Look*:

- **Import the fixture as a player would**: create the game with the ruleset the bead is about, then
  the **Import** button (`packages/shared/src/workspace/AppHeader.tsx`), setting its file input with
  the Chrome integration's file-upload tool to the fixture's absolute path. Read every control's
  label out of the component rather than recall it.
- **Read the figures the probe predicted**, and screenshot the cell or panel that shows each. A
  figure that differs from the probe is a finding only once the probe is known to match the orders
  the app holds (*An expected figure comes from the orders the app holds*, above).
- **The mockup.** A bead agreed with a mockup names it under `docs/ui/`. Open it in a second tab
  (serve its directory over http when Chrome will not open the `file://` URL:
  `python3 -m http.server <free port> --bind 127.0.0.1 --directory <dir>`, and stop it afterwards),
  compare it with the app, and screenshot both.
- **The console.** Read the console messages after the journey, filtered by a pattern rather than
  dumped whole. A new error or warning during the journey is a finding.

## Human checks: one hand-off per batch

Some criteria have no screenshot that settles them. They go to the navigator, prepared so their part
takes a minute or two:

- **"Good enough"**: whether a look, a layout, an animation or a sound is good enough — legibility on
  the map, whether a colour reads, whether a hover feels right. The acceptance cannot pin these down,
  and a screenshot shows only that something is there.
- **Desktop-only criteria** (*Which shell*, above), with the desktop shell already started.
- **Anything you could not reach**: a state the fixture and the app cannot build, a device or
  environment this machine does not have.

The hand-off, **once per batch**, after your own checks and before the report:

1. Leave the shell running and the app **in the exact state** to judge, in a tab you name: the game
   imported, the hex selected, the panel open, the order typed. Restore the storage snapshot only
   after they answer.
2. Write `asking`, then ask in **one** call of the question tool, one question per human check (at
   most four; split a longer list into consecutive calls). Each question says which bead it is for,
   the URL and tab (or the desktop window), what is on screen right now, what to judge and what good
   looks like, quoting the acceptance or `## Outcome`, and, where needed, a few numbered steps to
   try. Options: **Good**, **Concern** (works, but worth a follow-up), **Fail** (does not meet what
   was agreed), each with room for a note.
3. Write `working` the instant they answer. Copy each answer and note into that bead's log verbatim,
   attributed to the navigator. A human check left unanswered is a gap, not a pass.

A batch with no human check skips the hand-off and goes straight to the report. If the navigator is
away, the beads stay pending with the report attached, as verify-bead says, and the next pass
re-asks from the report without looking again.

## Explore near the change

After the agreed criteria and before the report, spend **about 10–15 minutes per batch** using the
app near what changed, as a curious player would. No script; aim at the change's edges:

- the neighbouring orders and their spelling variants (wrong case, an abbreviation, `ALL` where a
  number was, a quantity larger than the unit holds), looked up with `pnpm run atlantis` before you
  decide what the game would do;
- the units, hexes and panels one step away from the change, and the same check on another faction
  or turn the fixture carries;
- doing things in the wrong order, repeating them, or undoing them: delete the order and type it
  again, switch hex and come back, re-import the report;
- reloading the page with the change on screen, so what is stored comes back;
- the keyboard-only path through the controls the bead touched.

Log each finding with its steps, what appeared and a screenshot. Then sort it:

- **A regression this batch caused** — it worked before the bead's commit, and the bead's diff
  explains the break — counts against that bead's verdict. Say which criterion or outcome it breaks.
- **Everything else** (an older defect, a rough edge, an idea) is a proposed follow-up and never
  fails the bead.

When unsure which it is, say so in the report and recommend the follow-up. Past the quarter-hour the
returns drop off fast; stop, even with ideas left.

## Present the results

The report on each bead follows verify-bead's *Recommend* — its first line is
`Verification report at <full sha>` — with these sections:

- the bead's title and its batch;
- the shell, the fixture, the hex, and the storage snapshot's counts;
- the evidence log, one entry per criterion, with the human checks marked as the navigator's
  answers;
- **Exploration**: what you tried, and each finding with its sorting;
- the **gaps**: what nobody could reach;
- the **recommendation**: Passed, Passed with a follow-up, or Failed (build or plan), with the one
  or two facts it turns on;
- the **proposed follow-ups**: for each, a title in *Writing a good bead* form, the outcome for the
  player (or the developer), one acceptance line, and why it is not a defect in this bead. A defect
  in shipped behaviour is proposed as a bug (`--type bug --labels bugfix`), anything else as a task.
  Both are filed at P4, unranked, and only when the navigator approves them.

**A hand-made fixture announces itself** at the top of the report, before the evidence, with this
wording pattern, the parenthesised parts filled in:

> **The data here was made for this check.** No committed report has *(the shape that was
> missing)*, so I trimmed *(the report it came from)* down to *(what is left)*. It parses clean
> *(counts)* and *(the precondition)* — but it is not real game data, so a number that looks strange
> may be my fixture rather than the app.

Then in chat, before the verdict question, give the navigator a short summary per batch, with the
sha visible: one line per bead with the recommendation and the facts it turns on, then the
follow-ups. The full evidence is on the beads. Ask for the verdicts and the follow-ups in one call
where they fit in four questions, and in consecutive calls where they do not: accept or change each
recommended verdict, and file or drop each follow-up. Record only what they answered, by the recipes
in `agents/verifier.md`.

## When the build fails

**Never look at a broken application, and never recommend a verdict against one.** Say what failed,
in which tree, at which sha, with the error text; file nothing, change nothing, and leave the bead
`verification:pending`. It reaches the navigator in the terminal as a blocker (verify-bead's
*Launch*), never as a report.

Two build traps this project has already paid for (`.cerebro/traps.md`), worth knowing before you
report a failure as a mystery:

- **The smoke suite rebuilds the web bundle with the service worker disabled.** A PWA run started
  right after it fails with timeouts that look like a broken service worker, but nothing is actually
  broken — rebuild for the shell you are about to run, not whatever the smoke suite left behind.
- **`vite preview` without `--strictPort` silently serves somebody else's bundle.** A green-looking
  launch on the wrong build looks exactly like a passed verification of the wrong thing. Run the
  launch command exactly as `project-conf` declares it — it already carries the right flags.

## When the look is over

Restore the storage snapshot and reload the shell's tabs, close the tabs you opened, and stop every
server you started (the shell, the desktop shell, any `http.server` for a mockup), and only those.
A made fixture and the throwaway probe stay uncommitted in the verification tree, and nothing is
ever committed from it.
