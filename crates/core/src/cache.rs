//! Remembering the turn that was last parsed.
//!
//! Every entry point the adapters call takes the report as text, which is what keeps the calls
//! stateless: there is no session to open, and no session to invalidate when a new turn arrives.
//! The price was that the same four thousand lines were parsed three times per import and once more
//! for every route planned. Measured over three runs on one machine, that blocked the main thread
//! for 1204-1945 ms on a file open, against 262-429 ms with this. See the performance section of
//! `docs/ruleset-contract.md`, which also says which part of the gain came from where.
//!
//! This keeps the calls exactly as stateless as they were. The cache is keyed on the very text it
//! was built from, so asking twice with the same input is the same question and gets the same
//! answer; a new turn is simply a different key, and nothing has to be told about it. What changes
//! is only that the answer is no longer recomputed.
//!
//! The slots hold one entry each on purpose. A player has one turn open, so a second entry would
//! never be read.

use std::sync::{Arc, Mutex, OnceLock};

use crate::movement::rules::{Ruleset, RulesetError};
use crate::report::{classify_units, parse_report_full, ParsedReport};

/// The last report parsed, the last one classified, and the last ruleset read.
///
/// Held by value rather than reached through a global, so a test can drive one of its own and
/// assert on it without contending with whatever else `cargo test` is running beside it.
#[derive(Debug, Default)]
pub struct ReportCache {
    report: Option<(String, Arc<ParsedReport>)>,
    classified: Option<(String, String, Arc<ParsedReport>)>,
    ruleset: Option<(String, Arc<Ruleset>)>,
    parses: usize,
}

impl ReportCache {
    /// An empty cache.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// The report that text describes, parsed at most once.
    pub fn report(&mut self, raw: &str) -> Arc<ParsedReport> {
        if let Some((remembered, report)) = &self.report {
            if remembered == raw {
                return Arc::clone(report);
            }
        }

        let report = Arc::new(parse_report_full(raw));
        self.parses += 1;
        self.report = Some((raw.to_owned(), Arc::clone(&report)));
        report
    }

    /// The same report with every unit's men counted against the catalogue.
    ///
    /// A ruleset that cannot be used leaves the report exactly as parsed, estimates and all, which
    /// is what [`crate::movement::request::parse_and_classify`] has always promised: refusing to
    /// show a report because a ruleset would not load would trade something that works for
    /// something that does not.
    pub fn classified(&mut self, raw: &str, ruleset_json: &str) -> Arc<ParsedReport> {
        if let Some((remembered_report, remembered_ruleset, classified)) = &self.classified {
            if remembered_report == raw && remembered_ruleset == ruleset_json {
                return Arc::clone(classified);
            }
        }

        // Built from the plain parse rather than from the text, so a report already read for the
        // map is not read again for the planner. Classification needs its own copy because it
        // sharpens the units in place.
        let mut report = (*self.report(raw)).clone();
        if let Ok(ruleset) = self.ruleset(ruleset_json) {
            classify_units(&mut report, &ruleset);
        }

        let classified = Arc::new(report);
        self.classified = Some((
            raw.to_owned(),
            ruleset_json.to_owned(),
            Arc::clone(&classified),
        ));
        classified
    }

    /// [`classified`](Self::classified) when a ruleset is to hand, [`report`](Self::report) when
    /// none is.
    ///
    /// For the callers that store a report rather than draw it: whether a ruleset was fetchable is
    /// the shell's situation, not a parsing decision, and both storage adapters answering it with
    /// this one function is what keeps a turn stored on the desktop and the same turn stored in
    /// the browser identical.
    pub fn classified_when_possible(
        &mut self,
        raw: &str,
        ruleset_json: Option<&str>,
    ) -> Arc<ParsedReport> {
        match ruleset_json {
            Some(ruleset_json) => self.classified(raw, ruleset_json),
            None => self.report(raw),
        }
    }

    /// The ruleset that text describes, validated at most once.
    ///
    /// # Errors
    ///
    /// Returns whatever [`Ruleset::from_json`] refuses it with. A refusal is not remembered: it is
    /// cheap to reach again, and remembering it would mean deciding when to stop.
    pub fn ruleset(&mut self, ruleset_json: &str) -> Result<Arc<Ruleset>, RulesetError> {
        if let Some((remembered, ruleset)) = &self.ruleset {
            if remembered == ruleset_json {
                return Ok(Arc::clone(ruleset));
            }
        }

        let ruleset = Arc::new(Ruleset::from_json(ruleset_json)?);
        self.ruleset = Some((ruleset_json.to_owned(), Arc::clone(&ruleset)));
        Ok(ruleset)
    }

    /// How many reports this cache has actually parsed.
    ///
    /// Present so that "a turn is parsed once per import" can be asserted outright rather than
    /// inferred from a stopwatch. A timing guard can only say the work got faster.
    #[must_use]
    pub const fn parses(&self) -> usize {
        self.parses
    }
}

/// Runs `action` against the one cache the adapters share.
///
/// The lock is held for the length of the action and no longer, so nothing large is serialized
/// across a boundary while holding it. A cache poisoned by a panic elsewhere is taken back rather
/// than propagated: the worst a stale entry can do is be recomputed, which is where this started.
pub fn with_global<T>(action: impl FnOnce(&mut ReportCache) -> T) -> T {
    static GLOBAL: OnceLock<Mutex<ReportCache>> = OnceLock::new();

    let mutex = GLOBAL.get_or_init(|| Mutex::new(ReportCache::new()));
    let mut cache = mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    action(&mut cache)
}

#[cfg(test)]
mod tests {
    use super::*;

    const TURN_71: &str = atlantis_hud_fixtures::G7_F95_T71.text;
    const RULESET: &str = atlantis_hud_fixtures::RULESET_JSON;

    /// A report nothing else in the suite parses, so the shared-cache test cannot be disturbed.
    const LONELY: &str = "Lonely (1) Report\n";

    #[test]
    fn the_same_report_is_parsed_once() {
        let mut cache = ReportCache::new();

        let first = cache.report(TURN_71);
        let second = cache.report(TURN_71);

        assert!(Arc::ptr_eq(&first, &second), "the second look re-parsed");
        assert_eq!(cache.parses(), 1);
        assert_eq!(first.regions.len(), 11, "and it is the real report");
    }

    #[test]
    fn a_different_report_is_parsed_again() {
        let mut cache = ReportCache::new();

        let turn = cache.report(TURN_71);
        let other = cache.report(LONELY);

        assert!(!Arc::ptr_eq(&turn, &other));
        assert_eq!(cache.parses(), 2);
        assert!(
            other.regions.is_empty(),
            "and it really is the other report"
        );
    }

    /// Classification has to go *through* the plain parse rather than around it.
    ///
    /// On its own the test below cannot show this: a `classified` that parsed the text itself
    /// would leave the count at one there too, because the plain parse it skipped is the only one
    /// that ever ran. Asking a fresh cache to classify and finding the count at one is what pins
    /// that the plain slot is where the work happened.
    #[test]
    fn classifying_goes_through_the_plain_parse() {
        let mut cache = ReportCache::new();

        let _classified = cache.classified(TURN_71, RULESET);

        assert_eq!(
            cache.parses(),
            1,
            "classification parsed the text behind the cache's back"
        );
    }

    /// The point of the whole exercise: the parse the file-open made is the parse everything else
    /// gets to use.
    #[test]
    fn classifying_reuses_the_parse_already_made() {
        let mut cache = ReportCache::new();

        let _plain = cache.report(TURN_71);
        let _classified = cache.classified(TURN_71, RULESET);

        assert_eq!(
            cache.parses(),
            1,
            "classifying parsed the report a second time"
        );
    }

    #[test]
    fn the_same_classified_report_is_classified_once() {
        let mut cache = ReportCache::new();

        let first = cache.classified(TURN_71, RULESET);
        let second = cache.classified(TURN_71, RULESET);

        assert!(
            Arc::ptr_eq(&first, &second),
            "the second look classified again"
        );
        assert_eq!(cache.parses(), 1);
    }

    /// The control that keeps the two entries apart: a classified report knows something a plain
    /// one does not, so a cache that confused them would be visible here rather than silent.
    #[test]
    fn a_classified_report_counts_men_a_plain_parse_only_estimates() {
        let mut cache = ReportCache::new();

        let plain = cache.report(TURN_71);
        let classified = cache.classified(TURN_71, RULESET);

        assert!(plain.units().all(|unit| unit.men_estimated));
        assert!(classified.units().any(|unit| !unit.men_estimated));
    }

    /// The ruleset belongs in the key, and changing it must not cost another parse.
    #[test]
    fn the_same_report_under_a_different_ruleset_is_classified_again_but_not_parsed_again() {
        let mut cache = ReportCache::new();

        let counted = cache.classified(TURN_71, RULESET);
        let uncounted = cache.classified(TURN_71, "{}");

        assert!(
            !Arc::ptr_eq(&counted, &uncounted),
            "the ruleset is not in the key"
        );
        assert!(
            uncounted.units().all(|unit| unit.men_estimated),
            "an unusable ruleset leaves the report as parsed"
        );
        assert_eq!(
            cache.parses(),
            1,
            "the report did not change, so it was not re-read"
        );
    }

    #[test]
    fn a_ruleset_is_read_once() {
        let mut cache = ReportCache::new();

        let first = cache.ruleset(RULESET).expect("the ruleset loads");
        let second = cache.ruleset(RULESET).expect("the ruleset loads");

        assert!(Arc::ptr_eq(&first, &second), "the catalogue was read twice");
    }

    /// A refusal is not remembered, so it cannot lock out the ruleset that follows it.
    #[test]
    fn an_unusable_ruleset_is_refused_every_time_and_poisons_nothing() {
        let mut cache = ReportCache::new();

        assert!(cache.ruleset("{}").is_err());
        assert!(cache.ruleset("{}").is_err());
        assert!(cache.ruleset(RULESET).is_ok());
    }

    /// `with_global` hands out a real cache rather than a fresh one per call.
    ///
    /// Both calls happen under one lock deliberately. Held apart, another test running beside this
    /// one could parse a different report in between and take the slot, which would make this fail
    /// for a reason that has nothing to do with what it is asserting.
    #[test]
    fn the_shared_cache_is_a_cache() {
        let (first, second) = with_global(|cache| (cache.report(LONELY), cache.report(LONELY)));

        assert!(Arc::ptr_eq(&first, &second));
    }
}
