//! The false-positive bar for the order parser, set by a real game rather than by invented input.
//!
//! A syntax checker that invents errors is worse than none: the player stops reading the list, and
//! the one real mistake in it goes out with the turn. The orders template committed with turn 71 was
//! written by a person playing the game and accepted by the server, so every line in it is correct
//! by construction. Anything this parser has to say about it is something the parser got wrong.

use atlantis_hud_core::report::orders::extract_orders_template;
use atlantis_hud_core::validate_orders;

const TURN_71: &str = include_str!("../../../tests/fixtures/reports/neworigins-3.0.0-f95-t71.rep");
const RULESET: &str = include_str!("../../../config/public/ruleset.json");

fn template() -> String {
    extract_orders_template(TURN_71)
        .expect("the committed report carries an orders template")
        .text
}

#[test]
fn the_committed_template_has_nothing_wrong_with_it() {
    let result = validate_orders(&template(), None);

    assert_eq!(
        result.diagnostics,
        vec![],
        "the parser invented a problem with orders the server accepted"
    );
}

#[test]
fn the_committed_template_has_nothing_wrong_with_it_against_the_catalogue_either() {
    let result = validate_orders(&template(), Some(RULESET));

    assert_eq!(
        result.diagnostics,
        vec![],
        "every item these orders name is in the scraped catalogue"
    );
}

/// The template is not a trivial input: proving it clean means little if it holds three lines.
#[test]
fn the_template_is_substantial_enough_for_that_to_mean_something() {
    let template = template();
    let orders = template
        .lines()
        .filter(|line| {
            let body = line.trim().trim_start_matches('@');
            !body.is_empty() && !body.starts_with(';') && !body.starts_with('#')
        })
        .count();

    assert!(orders > 200, "only {orders} order lines to check");
}

/// The same document with one word changed is not clean, which is what makes the tests above a bar
/// rather than a tautology: a parser that found nothing anywhere would pass them and fail this.
#[test]
fn one_wrong_word_in_that_same_document_is_found() {
    let damaged = template().replace("@claim 50", "@claim fifty");
    let result = validate_orders(&damaged, None);

    assert_eq!(result.error_count(), 1, "{:?}", result.diagnostics);
    assert_eq!(result.diagnostics[0].code, "bad-argument");
    assert!(result.diagnostics[0].message.contains("fifty"));
}
