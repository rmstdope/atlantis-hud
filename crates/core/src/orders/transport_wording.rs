//! The words for a refused `TRANSPORT`/`DISTRIBUTE`, written once (`ah-9lyr`).
//!
//! Two readers state a refusal: the unit preview's hover, which reads
//! [`TransportTargetIssue::sentence`] as [`issue_sentence`] renders it, and the order's own
//! warning in `semantics.rs`, which composes the same clauses with its own goods. Before this
//! module the hover's words lived again in `packages/shared/src/unitPreview.ts`, and the two
//! copies drifted (`ah-1jl9`, `ah-lis2`). A new [`TransportTargetReason`] is worded here and
//! nowhere else.

use super::effects::{TransportReach, TransportTargetIssue, TransportTargetReason};

/// What [`issue_sentence`] appends to a refused TRANSPORT that the same line as DISTRIBUTE would
/// deliver, when the refusal names the goods (`ah-7j90`). The order's warning appends it too.
pub(crate) const DISTRIBUTE_DELIVERS_THEM: &str = "DISTRIBUTE would deliver them.";

/// Who refuses, for the four reasons the report proves: the target's missing skill or structure,
/// or the sender's (`ah-kjjv`, `ah-1jl9`, `ah-lis2`). `None` for every other reason, which is a
/// gap in the report or a distance and is worded otherwise.
pub(crate) fn refusal_clause(to: &str, reason: TransportTargetReason) -> Option<String> {
    match reason {
        TransportTargetReason::NotQuartermaster => {
            Some(format!("Unit {to} is not a quartermaster"))
        }
        TransportTargetReason::NotCaravanseraiOwner => {
            Some(format!("Unit {to} does not own a Caravanserai"))
        }
        // The sender's refusal, in its own words (`ah-1jl9`).
        TransportTargetReason::SenderOwnsNoCaravanserai => {
            Some("This unit owns no Caravanserai when the shipments run".to_string())
        }
        // A DISTRIBUTE asks its sender for the skill, never its target (`ah-lis2`).
        TransportTargetReason::SenderNotQuartermaster => {
            Some("This unit is not a quartermaster".to_string())
        }
        _ => None,
    }
}

/// Whose limit a reach refusal passed: the recipient quartermaster's acceptance, the distributing
/// quartermaster's own range (`ah-nzb0`), or the sender's shipping reach (`data/quartermaster`).
fn range_clause(reason: TransportTargetReason, limit: i64) -> String {
    match reason {
        TransportTargetReason::TooFarToDistribute => {
            format!("this unit distributes to units within {limit} hexes")
        }
        TransportTargetReason::TooFarToShip => format!("this unit can ship {limit} hexes"),
        _ => format!("takes goods from {limit} hexes"),
    }
}

/// How far apart the two ends of a reach refusal are, ahead of its ", so …" (`ah-7ale.2.1`,
/// `ah-e07g`): a distance and a limit, or two levels. A reach with neither shape keeps the
/// zeroes the hover always fell back to.
pub(crate) fn reach_clause(
    to: &str,
    reason: TransportTargetReason,
    reach: Option<&TransportReach>,
) -> String {
    if let Some(TransportReach {
        away: Some(away),
        limit: Some(limit),
        ..
    }) = reach
    {
        return format!(
            "Unit {to} is {away} hexes away and {}",
            range_clause(reason, *limit)
        );
    }
    if let Some(TransportReach {
        from_level: Some(from_level),
        to_level: Some(to_level),
        ..
    }) = reach
    {
        let to_name = crate::report::level::level_name(*to_level);
        let from_name = crate::report::level::level_name(*from_level);
        return format!("Unit {to} is in the {to_name} and this unit is on the {from_name}");
    }
    format!("Unit {to} is 0 hexes away and {}", range_clause(reason, 0))
}

/// What becomes of the goods: they stay, or the order moves nothing when it names none. The reach
/// refusals agree the verb with the count ("1 IRON stays"); the four target refusals keep the
/// unconditional "stay" they were agreed with (`ah-7ale.2.1`).
pub(crate) fn tail(order_word: &str, goods: Option<(i64, &str)>, agree: bool) -> String {
    match goods {
        Some((moved, tag)) => {
            let verb = if agree && moved == 1 { "stays" } else { "stay" };
            format!("{moved} {tag} {verb} with this unit")
        }
        None => format!("this {order_word} moves nothing"),
    }
}

/// One target issue as the unit preview's hover states it (`ah-64wm`), with the DISTRIBUTE hint
/// where the issue carries it (`ah-7j90`).
///
/// An issue naming a tag makes a claim about those goods - they stay here, or they could not be
/// counted. One naming none speaks of the order alone.
pub fn issue_sentence(issue: &TransportTargetIssue) -> String {
    let sentence = refusal_sentence(issue);
    match distribute_hint(issue) {
        Some(hint) => format!("{sentence} {hint}"),
        None => sentence,
    }
}

/// What the player can write instead, after a TRANSPORT refused on its target's account that the
/// same line as DISTRIBUTE would deliver (`ah-7j90`). An unsettled refusal says "either way", and
/// for another faction's unit (the only unsettled `NotCaravanseraiOwner` the flag rides on) adds
/// that the faction must accept.
fn distribute_hint(issue: &TransportTargetIssue) -> Option<String> {
    if !issue.distribute_delivers {
        return None;
    }
    if !issue.unsettled {
        return Some(DISTRIBUTE_DELIVERS_THEM.to_string());
    }
    Some(
        if issue.reason == TransportTargetReason::NotCaravanseraiOwner {
            format!(
            "DISTRIBUTE would deliver them either way, if unit {}'s faction accepts transports from yours.",
            issue.to
        )
        } else {
            "DISTRIBUTE would deliver them either way.".to_string()
        },
    )
}

fn refusal_sentence(issue: &TransportTargetIssue) -> String {
    let to = issue.to.as_str();
    let goods = (!issue.tag.is_empty()).then_some((issue.amount, issue.tag.as_str()));
    let goods_text = goods.map(|(amount, tag)| format!("{amount} {tag}"));
    // The word the line was written with, for a sentence that names the order (`ah-lis2`).
    let order_word = if issue.distribute {
        "DISTRIBUTE"
    } else {
        "TRANSPORT"
    };
    let order = format!("this {order_word}");

    if issue.unsettled {
        // The month may undo the refusal (`ah-nsz8`, the navigator's words of 2026-10-17): the
        // forecast keeps the goods here, but the hover does not say they certainly stay.
        let counted = format!(
            "Could not count {} for unit {to} because",
            goods_text.as_deref().unwrap_or("this TRANSPORT")
        );
        match issue.reason {
            TransportTargetReason::NotQuartermaster => {
                return format!("{counted} it is not a quartermaster now, but this month's orders may make it one before TRANSPORT runs.");
            }
            TransportTargetReason::NotCaravanseraiOwner => {
                return format!("{counted} it does not own a Caravanserai now, but this month's orders may change that before TRANSPORT runs.");
            }
            TransportTargetReason::SenderOwnsNoCaravanserai => {
                return format!("{counted} this unit owns no Caravanserai now, but this month's orders may change that before the shipments run.");
            }
            _ => {}
        }
    }

    let could_not_count = || {
        format!(
            "Could not count {} for unit {to} because",
            goods_text.as_deref().unwrap_or(&order)
        )
    };
    match issue.reason {
        TransportTargetReason::NotQuartermaster
        | TransportTargetReason::NotCaravanseraiOwner
        | TransportTargetReason::SenderOwnsNoCaravanserai
        | TransportTargetReason::SenderNotQuartermaster => {
            let who = refusal_clause(to, issue.reason).unwrap_or_default();
            format!("{who}, so {}.", tail(order_word, goods, false))
        }
        TransportTargetReason::EligibilityUnknown => format!(
            "{} your report does not show whether it is an eligible transport target.",
            could_not_count()
        ),
        TransportTargetReason::DistanceUnmeasured => format!(
            "{} your report does not show how far the world reaches around, so the distance cannot be worked out. Enter the map's width under Settings › Per game › Map to count it.",
            could_not_count()
        ),
        TransportTargetReason::AcceptanceUnknown => format!(
            "{} your report does not show whether its faction accepts transports from yours.",
            could_not_count()
        ),
        TransportTargetReason::TooFarToAccept
        | TransportTargetReason::TooFarToDistribute
        | TransportTargetReason::TooFarToShip => format!(
            "{}, so {}.",
            reach_clause(to, issue.reason, issue.reach.as_ref()),
            tail(order_word, goods, true)
        ),
    }
}

#[cfg(test)]
mod tests {
    //! Every sentence below was pinned, word for word, by `packages/shared/src/unitPreview.test.ts`
    //! before this module took the wording over (`ah-9lyr`); each names the bead that agreed it.
    use super::*;
    use TransportTargetReason as R;

    fn issue(
        to: &str,
        amount: i64,
        tag: &str,
        reason: TransportTargetReason,
    ) -> TransportTargetIssue {
        TransportTargetIssue {
            to: to.to_string(),
            amount,
            tag: tag.to_string(),
            reason,
            order_index: 0,
            reach: None,
            to_unshown: false,
            unsettled: false,
            distribute: false,
            distribute_delivers: false,
            sentence: String::new(),
        }
    }

    fn distance(away: i64, limit: i64) -> Option<TransportReach> {
        Some(TransportReach {
            away: Some(away),
            limit: Some(limit),
            from_level: None,
            to_level: None,
        })
    }

    fn says(issue: &TransportTargetIssue, expected: &str) {
        assert_eq!(issue_sentence(issue), expected);
    }

    // `ah-64wm`, against `docs/ui/ah-64wm-transport-targets.html`.
    #[test]
    fn the_target_refusals_say_the_goods_stay() {
        says(
            &issue("7001", 5, "STON", R::NotQuartermaster),
            "Unit 7001 is not a quartermaster, so 5 STON stay with this unit.",
        );
        says(
            &issue("7002", 5, "STON", R::NotCaravanseraiOwner),
            "Unit 7002 does not own a Caravanserai, so 5 STON stay with this unit.",
        );
    }

    // `ah-1jl9`.
    #[test]
    fn the_sender_owning_no_caravanserai_is_its_own_refusal() {
        says(&issue("1162", 500, "SILV", R::SenderOwnsNoCaravanserai), "This unit owns no Caravanserai when the shipments run, so 500 SILV stay with this unit.");
        says(&issue("1162", 0, "", R::SenderOwnsNoCaravanserai), "This unit owns no Caravanserai when the shipments run, so this TRANSPORT moves nothing.");
    }

    // `ah-lis2`: a sentence with no amount names the order the line was written with.
    #[test]
    fn a_distribute_is_called_a_distribute() {
        let distribute = |mut one: TransportTargetIssue| {
            one.distribute = true;
            one
        };
        says(
            &distribute(issue("1162", 100, "SILV", R::SenderNotQuartermaster)),
            "This unit is not a quartermaster, so 100 SILV stay with this unit.",
        );
        says(
            &distribute(issue("1162", 0, "", R::SenderNotQuartermaster)),
            "This unit is not a quartermaster, so this DISTRIBUTE moves nothing.",
        );
        says(&distribute(issue("1162", 0, "", R::SenderOwnsNoCaravanserai)), "This unit owns no Caravanserai when the shipments run, so this DISTRIBUTE moves nothing.");
        let mut unshown = distribute(issue("1162", 0, "", R::EligibilityUnknown));
        unshown.to_unshown = true;
        says(&unshown, "Could not count this DISTRIBUTE for unit 1162 because your report does not show whether it is an eligible transport target.");
    }

    #[test]
    fn the_gaps_in_the_report_could_not_be_counted() {
        says(&issue("99999", 5, "STON", R::EligibilityUnknown), "Could not count 5 STON for unit 99999 because your report does not show whether it is an eligible transport target.");
        says(&issue("7003", 5, "STON", R::AcceptanceUnknown), "Could not count 5 STON for unit 7003 because your report does not show whether its faction accepts transports from yours.");
    }

    #[test]
    fn an_order_with_no_per_tag_claim_speaks_of_the_order_alone() {
        says(
            &issue("7001", 0, "", R::NotQuartermaster),
            "Unit 7001 is not a quartermaster, so this TRANSPORT moves nothing.",
        );
        says(
            &issue("7002", 0, "", R::NotCaravanseraiOwner),
            "Unit 7002 does not own a Caravanserai, so this TRANSPORT moves nothing.",
        );
        says(&issue("99999", 0, "", R::EligibilityUnknown), "Could not count this TRANSPORT for unit 99999 because your report does not show whether it is an eligible transport target.");
    }

    // `ah-7ale.2.1`, `ah-nzb0`, `ah-e07g`.
    #[test]
    fn a_reach_refusal_names_whose_limit_it_passed() {
        let far = |to, amount, tag, reason, reach| {
            let mut one = issue(to, amount, tag, reason);
            one.reach = reach;
            one
        };
        says(
            &far("901", 5, "STON", R::TooFarToAccept, distance(3, 2)),
            "Unit 901 is 3 hexes away and takes goods from 2 hexes, so 5 STON stay with this unit.",
        );
        says(&far("2420", 100, "SILV", R::TooFarToDistribute, distance(3, 2)), "Unit 2420 is 3 hexes away and this unit distributes to units within 2 hexes, so 100 SILV stay with this unit.");
        says(&far("901", 1, "IRON", R::TooFarToShip, distance(4, 3)), "Unit 901 is 4 hexes away and this unit can ship 3 hexes, so 1 IRON stays with this unit.");
        says(
            &far("901", 9, "FUR", R::TooFarToAccept, Some(TransportReach { away: None, limit: None, from_level: Some(1), to_level: Some(2) })),
            "Unit 901 is in the underworld and this unit is on the surface, so 9 FUR stay with this unit.",
        );
        says(&far("901", 0, "", R::TooFarToAccept, distance(3, 2)), "Unit 901 is 3 hexes away and takes goods from 2 hexes, so this TRANSPORT moves nothing.");
        says(&far("901", 0, "", R::TooFarToShip, distance(4, 3)), "Unit 901 is 4 hexes away and this unit can ship 3 hexes, so this TRANSPORT moves nothing.");
    }

    // `ah-7ale.5`.
    #[test]
    fn an_unmeasured_distance_points_at_the_map_setting() {
        says(&issue("902", 9, "FUR", R::DistanceUnmeasured), "Could not count 9 FUR for unit 902 because your report does not show how far the world reaches around, so the distance cannot be worked out. Enter the map's width under Settings › Per game › Map to count it.");
        says(&issue("902", 0, "", R::DistanceUnmeasured), "Could not count this TRANSPORT for unit 902 because your report does not show how far the world reaches around, so the distance cannot be worked out. Enter the map's width under Settings › Per game › Map to count it.");
    }

    // `ah-nsz8`.
    #[test]
    fn a_refusal_the_month_may_undo_is_not_stated_as_certain() {
        let unsettled = |reason, tag, amount| {
            let mut one = issue("901", amount, tag, reason);
            one.unsettled = true;
            one
        };
        says(&unsettled(R::NotQuartermaster, "SILV", 100), "Could not count 100 SILV for unit 901 because it is not a quartermaster now, but this month's orders may make it one before TRANSPORT runs.");
        says(&unsettled(R::NotCaravanseraiOwner, "SILV", 100), "Could not count 100 SILV for unit 901 because it does not own a Caravanserai now, but this month's orders may change that before TRANSPORT runs.");
        says(&unsettled(R::SenderOwnsNoCaravanserai, "SILV", 100), "Could not count 100 SILV for unit 901 because this unit owns no Caravanserai now, but this month's orders may change that before the shipments run.");
        says(&unsettled(R::NotQuartermaster, "", 0), "Could not count this TRANSPORT for unit 901 because it is not a quartermaster now, but this month's orders may make it one before TRANSPORT runs.");
    }

    // `ah-7j90`, against `docs/ui/ah-7j90-distribute-hint.html` and `-uncertain.html`.
    #[test]
    fn a_transport_a_distribute_would_deliver_says_so() {
        let refused = |to: &str, reason, unsettled, delivers| {
            let mut one = issue(to, 100, "SILV", reason);
            one.unsettled = unsettled;
            one.distribute_delivers = delivers;
            one
        };
        says(&refused("901", R::NotQuartermaster, false, true), "Unit 901 is not a quartermaster, so 100 SILV stay with this unit. DISTRIBUTE would deliver them.");
        says(&refused("901", R::NotQuartermaster, true, true), "Could not count 100 SILV for unit 901 because it is not a quartermaster now, but this month's orders may make it one before TRANSPORT runs. DISTRIBUTE would deliver them either way.");
        says(&refused("7100", R::NotCaravanseraiOwner, true, true), "Could not count 100 SILV for unit 7100 because it does not own a Caravanserai now, but this month's orders may change that before TRANSPORT runs. DISTRIBUTE would deliver them either way, if unit 7100's faction accepts transports from yours.");
        says(
            &refused("901", R::NotQuartermaster, false, false),
            "Unit 901 is not a quartermaster, so 100 SILV stay with this unit.",
        );
        says(&refused("901", R::NotQuartermaster, true, false), "Could not count 100 SILV for unit 901 because it is not a quartermaster now, but this month's orders may make it one before TRANSPORT runs.");
    }
}
