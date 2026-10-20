//! How a sailing passenger's STUDY fared in the hex its fleet lands in - settled once, by the
//! settlement ([`super::send_studies_where_fleets_arrive`] and
//! [`super::settle_studies_where_fleets_arrive`]), and read by every surface through this record
//! (`ah-3qw8`).
//!
//! STUDY is a month-long order, run after movement (`rules/sequenceofevents`), and `SHARE` lends
//! to units "in the same region" (`rules/share`), so a passenger's STUDY is the landing hex's
//! purse's to pay or refuse. Its upkeep is not: maintenance falls due where it ends the month
//! (`rules/sequenceofevents`), on its own row, and nothing here settles it. Every question below
//! answers for the STUDY alone, so what a surface has left to say of the passenger is its upkeep.
//!
//! The fields are private to this module on purpose: a surface that needs another answer adds a
//! question here, where every verdict is in view, rather than reading the record its own way -
//! seven bugs in three days came from surfaces doing that (`ah-3qw8`).

use std::collections::BTreeMap;

use super::{HexMembership, LendingMoment, StudyOutcome};
use crate::ProblemsElsewhere;

/// Every passenger of one hex whose STUDY was sent to the purse where its fleet lands, by unit
/// id: the record of the hex the report lists them in.
#[derive(Debug, Clone, Default)]
pub(super) struct LandingStudies {
    by_unit: BTreeMap<String, LandingStudy>,
}

/// One passenger's STUDY, as the purse where its fleet lands settled it.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub(super) struct LandingStudy {
    /// What its STUDY asks of that purse: its overdraft at STUDY, as the hex it leaves reads it.
    claim: i64,
    /// How that purse settled it; `None` until it has.
    outcome: Option<StudyOutcome>,
    /// The hex its fleet lands in, where something of ours shares there - the hex whose marker
    /// tells the passenger of a refusal (`ah-1uja`). `None` where nothing of ours shares there
    /// (`ah-oi3u`): no hex is then short "between its units", and the passenger's own sentence
    /// carries the refusal.
    marked: Option<ProblemsElsewhere>,
    /// Who lent it the fee there, and how much each, in the order the purse drew on them
    /// (`ah-kjq5`). Empty until it has settled, and where nothing there lent.
    lent_by: Vec<(String, i64)>,
    /// The hex its fleet lands in, written for a loan's line (`ah-kjq5`).
    lands: String,
}

impl LandingStudies {
    /// Forgets every passenger: the settlement rebuilds the record from nothing each time.
    pub(super) fn clear(&mut self) {
        self.by_unit.clear();
    }

    /// Sends `unit_id`'s STUDY to the purse where its fleet lands, `marked` naming that hex where
    /// something of ours shares there.
    pub(super) fn send(&mut self, unit_id: String, marked: Option<ProblemsElsewhere>) {
        self.by_unit.insert(
            unit_id,
            LandingStudy {
                marked,
                ..LandingStudy::default()
            },
        );
    }

    /// Records what `unit_id`'s STUDY asks of the purse it was sent to.
    pub(super) fn claim(&mut self, unit_id: &str, claim: i64) {
        if let Some(study) = self.by_unit.get_mut(unit_id) {
            study.claim = claim;
        }
    }

    /// Records how the purse where `unit_id`'s fleet lands settled its STUDY.
    pub(super) fn settle(
        &mut self,
        unit_id: &str,
        outcome: StudyOutcome,
        lent_by: Vec<(String, i64)>,
        lands: String,
    ) {
        if let Some(study) = self.by_unit.get_mut(unit_id) {
            study.outcome = Some(outcome);
            study.lent_by = lent_by;
            study.lands = lands;
        }
    }

    /// `unit_id`'s STUDY, where it was sent to the purse its fleet lands in; `None` for a study
    /// its own hex judges.
    pub(super) fn of(&self, unit_id: &str) -> Option<&LandingStudy> {
        self.by_unit.get(unit_id)
    }
}

impl LandingStudy {
    /// How the purse where its fleet lands settled it, once it has.
    pub(super) fn outcome(&self) -> Option<StudyOutcome> {
        self.outcome
    }

    /// Whether that purse has still to settle it: what it asks is then that purse's claim, not
    /// the claim of the hex it leaves (`ah-q1zz`).
    pub(super) fn is_pending(&self) -> bool {
        self.outcome.is_none()
    }

    /// What it asks of the purse where its fleet lands at `moment`: nothing before movement,
    /// when it has not sailed, and its whole claim from then on - none of it is the hex it leaves
    /// to answer for (`ah-q1zz`).
    pub(super) fn claim_at(&self, moment: LendingMoment) -> i64 {
        if HexMembership::before_movement(moment) {
            0
        } else {
            self.claim
        }
    }

    /// Its claim, where that purse refused it - what a reading that hands back a refused fee
    /// must take off again (`ah-q1zz` review, finding 3); `0` otherwise.
    pub(super) fn refused_claim(&self) -> i64 {
        if matches!(self.outcome, Some(StudyOutcome::Refused { .. })) {
            self.claim
        } else {
            0
        }
    }

    /// The landing hex whose marker tells it of a refusal (`ah-1uja`); `None` where nothing of
    /// ours shares there (`ah-oi3u`).
    pub(super) fn marked_landing(&self) -> Option<&ProblemsElsewhere> {
        self.marked.as_ref()
    }

    /// Whether its refusal is told by the landing hex's marker on its STUDY line alone, so its
    /// own sentence says nothing of its STUDY (`ah-65kt`).
    pub(super) fn told_by_landing_marker(&self) -> bool {
        self.marked.is_some() && self.refused_claim() > 0
    }

    /// What of its STUDY fee the purse where its fleet lands settled, so the hex it sails from
    /// never reads it as its own STUDY's spend: the loan towards a paid study (`ah-w89e`), or the
    /// claim of one a marked landing hex refused, which took nothing (`ah-65kt`); `0` otherwise.
    /// What its row is left short of after this is its upkeep.
    pub(super) fn settled_there(&self) -> i64 {
        match self.outcome {
            Some(StudyOutcome::Paid { lent, .. }) => lent,
            _ if self.marked.is_some() => self.refused_claim(),
            _ => 0,
        }
    }

    /// Who lent it its fee where its fleet lands, and that place, for a study paid there
    /// (`ah-kjq5`); `None` for one pending or refused.
    pub(super) fn lent_across(&self) -> Option<(&[(String, i64)], &str)> {
        matches!(self.outcome, Some(StudyOutcome::Paid { .. }))
            .then(|| (self.lent_by.as_slice(), self.lands.as_str()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn landing() -> ProblemsElsewhere {
        ProblemsElsewhere {
            region_id: "r2".to_string(),
            label: "plain (2,2)".to_string(),
        }
    }

    fn sent(marked: Option<ProblemsElsewhere>, claim: i64) -> LandingStudies {
        let mut studies = LandingStudies::default();
        studies.send("7".to_string(), marked);
        studies.claim("7", claim);
        studies
    }

    #[test]
    fn a_sent_study_is_pending_until_settled() {
        let studies = sent(Some(landing()), 30);
        let study = studies.of("7").expect("sent");
        assert!(study.is_pending());
        assert_eq!(study.outcome(), None);
        assert_eq!(study.settled_there(), 0);
        assert_eq!(study.refused_claim(), 0);
        assert!(!study.told_by_landing_marker());
        assert_eq!(study.lent_across(), None);
        assert!(
            studies.of("8").is_none(),
            "a study judged at home has no record"
        );
    }

    #[test]
    fn a_paid_study_settles_its_loan_there_and_lists_its_lenders() {
        let mut studies = sent(Some(landing()), 30);
        studies.settle(
            "7",
            StudyOutcome::Paid { own: 20, lent: 30 },
            vec![("Bank (12)".to_string(), 30)],
            "plain (2,2) in Nexus".to_string(),
        );
        let study = studies.of("7").expect("sent");
        assert!(!study.is_pending());
        assert_eq!(study.settled_there(), 30);
        assert_eq!(study.refused_claim(), 0);
        assert!(!study.told_by_landing_marker());
        assert_eq!(
            study.lent_across(),
            Some((&[("Bank (12)".to_string(), 30)][..], "plain (2,2) in Nexus"))
        );
    }

    #[test]
    fn a_study_refused_by_a_marked_landing_hex_is_told_by_its_marker() {
        let mut studies = sent(Some(landing()), 30);
        studies.settle(
            "7",
            StudyOutcome::Refused { fee: 50, short: 30 },
            Vec::new(),
            "plain (2,2) in Nexus".to_string(),
        );
        let study = studies.of("7").expect("sent");
        assert_eq!(study.refused_claim(), 30);
        assert_eq!(study.settled_there(), 30);
        assert!(study.told_by_landing_marker());
        assert_eq!(study.marked_landing(), Some(&landing()));
        assert_eq!(study.lent_across(), None);
    }

    #[test]
    fn a_study_refused_where_nothing_of_ours_shares_is_handed_back_but_not_marked() {
        let mut studies = sent(None, 30);
        studies.settle(
            "7",
            StudyOutcome::Refused { fee: 50, short: 30 },
            Vec::new(),
            "plain (2,2) in Nexus".to_string(),
        );
        let study = studies.of("7").expect("sent");
        assert_eq!(study.refused_claim(), 30);
        assert_eq!(study.settled_there(), 0, "its own sentence carries it");
        assert!(!study.told_by_landing_marker());
        assert_eq!(study.marked_landing(), None);
    }

    #[test]
    fn a_claim_is_nobodys_before_movement() {
        let studies = sent(Some(landing()), 30);
        let study = studies.of("7").expect("sent");
        assert_eq!(study.claim_at(LendingMoment::Cast), 0);
        assert_eq!(study.claim_at(LendingMoment::Movement), 0);
        assert_eq!(study.claim_at(LendingMoment::Study), 30);
        assert_eq!(study.claim_at(LendingMoment::MonthEnd), 30);
    }
}
