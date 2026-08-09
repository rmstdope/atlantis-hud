-- A "project" was always the player's game; only the word was borrowed.
--
-- Issue #33 makes the game something the player creates, names, picks a ruleset for and switches
-- between, so the schema says `game` too. The columns are renamed rather than rebuilt: SQLite's
-- RENAME COLUMN carries the composite primary keys and the indexes with it, so no data moves and
-- nothing has to be copied out and back.
ALTER TABLE project_metadata RENAME TO game_metadata;
ALTER TABLE game_metadata RENAME COLUMN project_id TO game_id;
ALTER TABLE game_metadata RENAME COLUMN project_name TO game_name;

-- Which ruleset a game is played under. Empty for a game created before the question was asked,
-- which is why it carries a default rather than a NOT NULL with no answer.
ALTER TABLE game_metadata ADD COLUMN ruleset_id TEXT NOT NULL DEFAULT '';

ALTER TABLE imported_turns RENAME COLUMN project_id TO game_id;
ALTER TABLE order_drafts RENAME COLUMN project_id TO game_id;
ALTER TABLE region_sightings RENAME COLUMN project_id TO game_id;

-- The indexes followed their columns automatically, but their names did not.
DROP INDEX IF EXISTS imported_turns_project_turn_idx;
CREATE INDEX IF NOT EXISTS imported_turns_game_turn_idx
    ON imported_turns (game_id, turn_number);

DROP INDEX IF EXISTS order_drafts_project_turn_idx;
CREATE INDEX IF NOT EXISTS order_drafts_game_turn_idx
    ON order_drafts (game_id, turn_number);

DROP INDEX IF EXISTS region_sightings_last_seen_idx;
CREATE INDEX IF NOT EXISTS region_sightings_last_seen_idx
    ON region_sightings (game_id, faction_id, last_seen_turn);
