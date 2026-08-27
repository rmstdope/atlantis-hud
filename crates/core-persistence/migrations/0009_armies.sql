CREATE TABLE IF NOT EXISTS armies (
    id TEXT PRIMARY KEY NOT NULL,
    game_id TEXT NOT NULL,
    name TEXT NOT NULL,
    members_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS armies_game_idx
    ON armies (game_id);
