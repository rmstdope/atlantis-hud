-- ah-lyg6.2.3: a mage's plan grows from one study to an ordered queue of goals.
--
-- The queue is one JSON text column, which is `armies.members_json`'s shape and its reasoning
-- (core-persistence's `save_army`): one row per mage, matching the web side, where IndexedDB
-- stores the whole record and a nested list comes free.
--
-- Rebuilt rather than ALTERed: dropping a column needs a SQLite this repository has never named a
-- floor for, and a rebuild is what 0005 chose when RENAME could not do the job.
CREATE TABLE study_plans_new (
    game_id TEXT NOT NULL,
    faction_id TEXT NOT NULL,
    unit_id TEXT NOT NULL,
    goals_json TEXT NOT NULL,
    comment TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (game_id, faction_id, unit_id)
);

-- Every row written before this held one study at most, so it becomes a one-goal queue. Built by
-- concatenation rather than json_object(): the JSON1 extension is not something this crate has
-- ever declared it is compiled with, and a skill tag is upper-case ASCII, so nothing needs
-- escaping.
INSERT INTO study_plans_new (game_id, faction_id, unit_id, goals_json, comment, updated_at)
SELECT game_id,
       faction_id,
       unit_id,
       CASE
         WHEN skill IS NULL THEN '[]'
         ELSE '[{"skill":"' || skill || '","targetLevel":'
              || COALESCE(CAST(target_level AS TEXT), 'null') || '}]'
       END,
       comment,
       updated_at
  FROM study_plans;

DROP TABLE study_plans;
ALTER TABLE study_plans_new RENAME TO study_plans;
