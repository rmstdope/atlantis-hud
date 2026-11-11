-- Whether an Army was made through the assistant connection (ah-mjiv1).
--
-- The assistant may change only the Armies it made, for good, and the units dock's rail marks them
-- with an "assistant" pill. 0 for every Army stored before this column existed: those were all made
-- by hand.
ALTER TABLE armies ADD COLUMN made_by_assistant INTEGER NOT NULL DEFAULT 0;
