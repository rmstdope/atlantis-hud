-- ah-9qdz.2: a plan names the spell each planned turn casts, beside its goals.
--
-- Its own JSON column rather than a field of each goal: a cast can sit on a turn with no goal at
-- all (`rules/magic_usingmagic`: a CAST is not a month-long order). Every row written before this
-- plans no cast, which the default says. ADD COLUMN with a constant default needs no rebuild.
ALTER TABLE study_plans ADD COLUMN casts_json TEXT NOT NULL DEFAULT '[]';
