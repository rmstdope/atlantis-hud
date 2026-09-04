CREATE TABLE IF NOT EXISTS allied_mages (
    game_id TEXT NOT NULL,
    faction_id TEXT NOT NULL,
    unit_id TEXT NOT NULL,
    faction_name TEXT,
    unit_json TEXT NOT NULL,
    sheet_turn INTEGER NOT NULL,
    received_at TEXT NOT NULL,
    PRIMARY KEY (game_id, faction_id, unit_id)
);
