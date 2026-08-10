-- Which allied reports have been folded into a faction's map, and when.
--
-- Merging writes an ally's regions under the *viewer's* faction id and stores no imported turn of
-- the ally's, so once it is done nothing in the database says where the extra hexes came from. The
-- map simply got bigger, which is a poor thing to discover after a restart.
--
-- This table is that record. It is what the header counts, and it is why reopening a game can still
-- say "Borg (73) was merged into your turn 71" rather than leaving the player to guess whose eyes
-- they are looking through.
--
-- Keyed by the turn as well as the two factions: merging is only ever allowed between reports of
-- one turn, so which turn a merge belongs to is part of what happened, not an incidental detail.
--
-- No secondary index. This is a rowid table, so the composite primary key already builds one, and
-- its leading columns are exactly the three the only query filters on. An index on that same prefix
-- would be a second copy of the first, paid for on every write.
CREATE TABLE IF NOT EXISTS merged_reports (
    game_id TEXT NOT NULL,
    faction_id TEXT NOT NULL,
    turn_number INTEGER NOT NULL,
    merged_faction_id TEXT NOT NULL,
    merged_faction_name TEXT NOT NULL,
    merged_at TEXT NOT NULL,
    PRIMARY KEY (game_id, faction_id, turn_number, merged_faction_id)
);
