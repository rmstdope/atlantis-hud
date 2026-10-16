# ah-ezyg — retrospective

## `npx prettier --write` over a directory reformatted 50 files, the seventh time on record

**What happened.** After joining the coordinates to every map look's settlement name I ran
`npx prettier --write src/workspace/mapThemes` to tidy the indentation a scripted edit had left. With
no prettier config in the repository it applied prettier's defaults (trailing commas, 80 columns)
and rewrote 50 files, about 2,800 lines, none of them part of the change.

**Why.** The habit of "tidy after a scripted edit" reaches for prettier. The repository has no
formatter: ESLint with no formatting rules, and the style is whatever the files already hold.
Nothing tells you that until you see the diff.

**Cost.** About five minutes: `git checkout` of the directory, redoing the eleven intended edits by
script, and rewriting the two new files by hand. It was caught before a commit, so nothing reached a
reviewer.

**Prevent by.** One line in `.cerebro/traps.md`: "There is no formatter: never run `npx prettier`;
fix indentation by hand." Six retrospectives have recorded this already, which is the case for
promoting it to a trap. Alternatively, a `.prettierrc` that matches the house style (no trailing
commas, 100 columns), so an accidental run is harmless.

**Seen before.** ah-mw1r.3, ah-lbd9.4, ah-t8c4, ah-49is, ah-dbw4, ah-g9sf.7.1.
