-- ah-lyg6.3: a goal is now a tagged union - a month of study, or a month spent teaching.
--
-- Every goal written before this bead was a study, and every one of them starts with the literal
-- `{"skill":` - 0012 wrote them by concatenation with that prefix, and serde serialises
-- `StudyGoal`'s fields in declaration order, `skill` first. So stamping the tag in is a textual
-- replace rather than anything that needs the JSON1 extension, which this crate has never declared
-- it is compiled with.
UPDATE study_plans
   SET goals_json = replace(goals_json, '{"skill":', '{"kind":"study","skill":')
 WHERE goals_json LIKE '%{"skill":%';
