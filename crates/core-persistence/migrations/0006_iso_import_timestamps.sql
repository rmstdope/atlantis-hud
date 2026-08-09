-- Imported turns used to stamp themselves with SQLite's CURRENT_TIMESTAMP, which writes
-- "2026-08-09 18:30:00". Order drafts have always carried a caller-supplied ISO-8601 string,
-- "2026-08-09T18:30:00Z". Ranking a game's turns by whichever was touched last has to compare the
-- two, and comparing them as text is wrong at character ten: a space sorts before "T", so any
-- draft dated a given day beats any import that day whatever the clock said.
--
-- CURRENT_TIMESTAMP is UTC, so appending "Z" states what the value already meant rather than
-- guessing at it. The LIKE guard is what keeps this from touching a row that is already ISO.

UPDATE imported_turns
   SET imported_at = REPLACE(imported_at, ' ', 'T') || 'Z'
 WHERE imported_at LIKE '____-__-__ __:__:__';

UPDATE imported_turns
   SET updated_at = REPLACE(updated_at, ' ', 'T') || 'Z'
 WHERE updated_at LIKE '____-__-__ __:__:__';
