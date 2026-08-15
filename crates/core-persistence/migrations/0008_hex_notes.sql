CREATE TABLE IF NOT EXISTS hex_notes (
    id TEXT PRIMARY KEY NOT NULL,
    game_id TEXT NOT NULL,
    region_id TEXT NOT NULL,
    text TEXT NOT NULL,
    on_map INTEGER NOT NULL,
    turn INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS hex_notes_game_region_idx
    ON hex_notes (game_id, region_id);
