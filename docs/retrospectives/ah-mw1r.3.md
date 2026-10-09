# ah-mw1r.3 — CREATE VILLAGE consumes its founders

## npx prettier rewrote two whole files around a three-line change

**What happened.** After adding one `case` arm to `packages/shared/src/unitCellPopup.ts` and one
table row to its test, I ran `npx prettier --write` on both files to tidy them. With no project
config, Prettier applied its defaults. That came to about 2,800 changed lines of trailing commas and
re-wrapped lines. `check:fast` passed, because nothing in it fails on a formatting-only diff. The
cold-read review blocked the merge on it.

**Why.** Reflex: reaching for a formatter after editing TypeScript, without first checking that the
repository declares one. It does not. `check:fast`'s `lint` leg is the only authority on TypeScript
style.

**Cost.** One review round trip, a revert, and re-applying the two hunks by hand: about ten minutes.

**Prevent by.** As before, add the line ah-g9sf.7.1 proposed for `.cerebro/traps.md`: "this
repository declares no formatter; `npx prettier` rewrites whole files". The stronger fix is still
the one `ah-t8c4` named: a `check:fast` leg that fails when `npx prettier --check` passes on a
touched file that main's copy fails, which is the signature of a stray reformat.

**Seen before.** `ah-g9sf.7.1`, `ah-dbw4`, `ah-t8c4`, `ah-lbd9.4`. This is the fifth sighting.
