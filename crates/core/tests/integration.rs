//! Every integration test of `crates/core` except `movement/`, built as one program.
//!
//! Cargo runs test programs one after another, but runs the tests inside one program in parallel.
//! With one program per file the Rust suite took the sum of about a hundred programs' times
//! (ah-dt118), so the files are declared here as modules instead, and `Cargo.toml` turns off
//! cargo's own discovery with `autotests = false`.
//!
//! A new test file in `tests/` therefore needs one `mod` line below, where `cargo fmt` keeps the
//! lines sorted. It reaches the shared helpers with `use crate::common;`. A file left out would
//! compile into nothing and never run, which `every_test_file_is_compiled_into_this_program` stops.
//! Run one file's tests with `cargo test -p atlantis-hud-core --test integration <file>::`.

mod common;

mod a_build_on_a_sharers_goods;
mod a_buy_the_purse_paid_in_full_is_not_short;
mod a_capped_study_is_charged_by_neither_surface;
mod a_cast_creation_on_a_real_turn;
mod a_contended_taxers_buy_all;
mod a_contended_taxers_cast;
mod a_contended_taxers_numbered_buy;
mod a_cut_buy_leaves_a_sharing_hex_short_at_the_market;
mod a_discard_from_shared_stock;
mod a_dissolving_form_across_both_surfaces;
mod a_distribute_from_a_unit_that_is_not_a_quartermaster;
mod a_draw_that_leaves_upkeep_unpaid;
mod a_fleet_refused_at_its_first_step;
mod a_fleet_that_will_not_sail_stays;
mod a_formed_unit_inherits_flag_orders_above_its_form;
mod a_gift_to_a_unit_not_in_the_hex;
mod a_gift_to_an_unshown_number_gives_nothing;
mod a_give_funded_by_a_sharer_in_report_order;
mod a_hex_shared_with_an_unread_unit;
mod a_hex_silver_shortfall_reads_non_negative;
mod a_late_exchange_the_game_aborts;
mod a_leave_refused_at_sea;
mod a_lone_sell_all_is_not_oversubscribed;
mod a_lone_sharer_short_of_upkeep;
mod a_market_shared_with_an_unread_unit;
mod a_new_age_distribute_is_a_transport;
mod a_new_ship_is_built;
mod a_pillage_is_priced_from_one_set_of_facts;
mod a_pool_shared_with_a_foreign_unit;
mod a_promoted_passenger_stays_in_port;
mod a_quartermaster_that_gives_up_its_caravanserai;
mod a_refused_cast_reaches_the_items_column;
mod a_refused_order_charges_nothing;
mod a_refused_recruitment_costs_nothing;
mod a_sailing_captain_names_whom_it_lent;
mod a_sale_of_more_than_is_held;
mod a_sale_the_market_refuses;
mod a_sharer_drained_by_a_give_studies_on_the_purse;
mod a_sharing_hexs_settled_purse;
mod a_sharing_passenger_keeps_its_study_loan;
mod a_sharing_student_a_faction_mate_pays_for;
mod a_short_purchase_says_how_many_it_buys;
mod a_study_a_sharer_pays_for;
mod a_theft_is_never_counted;
mod a_transport_to_a_unit_that_cannot_receive_it;
mod a_unit_read_without_its_money;
mod an_arriving_crew_lends_upkeep_after_the_residents;
mod an_arriving_sharers_build;
mod an_evicted_unit_stands_outside;
mod an_exchange_draws_on_sharers;
mod an_exchange_moves_both_sides;
mod an_exchange_the_game_aborts;
mod an_item_doubt_leaves_the_shared_silver_counted;
mod an_order_loan_names_both_parties;
mod an_overloaded_walker_stays;
mod an_unanswered_exchange_does_not_hide_a_short_one;
mod buy_all_across_both_surfaces;
mod common_fleet_that_sails;
mod corpus_errors;
mod create_village_consumes_its_founders;
mod create_village_near_a_settlement;
mod create_village_refused;
mod create_village_twice_in_one_month;
mod enter_a_structure_not_here;
mod entertain_without_the_skill;
mod exchange_chains_settle_in_report_order;
mod export_map;
mod faction_order;
mod food_eaten_for_upkeep;
mod generated_ts;
mod gifts_across_both_surfaces;
mod give_all_silver_precedes_the_study;
mod give_all_silver_precedes_the_tax;
mod item_text_matches_the_engine;
mod known_map;
mod mage_sheet_fixtures;
mod meals_are_cooked;
mod merge_reports;
mod month_long_orders_settle_in_report_order;
mod move_into_a_wall;
mod new_students;
mod no_guard_at_sea;
mod numbered_production;
mod orders_preview;
mod parse_real_reports;
mod phase_silver_for_a_cast;
mod pillage_warning_reads_in_place;
mod preview_row_lookup;
mod production_after_a_gift;
mod production_after_the_market;
mod production_matches_the_hexs_yield;
mod production_over_the_region_limit;
mod production_overview;
mod quest_and_explore_hand_in_their_items;
mod recruitment_production_agreement;
mod sailing_across_both_surfaces;
mod sale_funded_cast_in_a_sharing_hex;
mod silver_agrees_with_the_warning;
mod silver_for_a_production;
mod silver_totals_are_its_movements;
mod the_hover_and_the_problem_say_the_same_thing;
mod the_market_warning_counts_what_the_game_buys;
mod turn_number_matches_the_engine;
mod unit_composition;
mod units_read_completely;
mod unwrap_real_report;
mod validate_real_orders;

/// `autotests = false` means cargo no longer finds a test file by itself, so a file without its
/// `mod` line here would silently never run.
#[test]
fn every_test_file_is_compiled_into_this_program() {
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests");
    let this = std::fs::read_to_string(dir.join("integration.rs")).expect("this file reads");
    let mut missing: Vec<String> = std::fs::read_dir(&dir)
        .expect("the tests directory reads")
        .map(|entry| entry.expect("a directory entry").path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "rs"))
        .filter_map(|path| Some(path.file_stem()?.to_str()?.to_owned()))
        .filter(|stem| stem != "integration")
        .filter(|stem| !this.lines().any(|line| line == format!("mod {stem};")))
        .collect();
    missing.sort();
    assert!(
        missing.is_empty(),
        "these files in crates/core/tests/ are not declared in integration.rs and would never run: {missing:?}"
    );
}

/// Cargo used to build any `tests/<dir>/main.rs` as a program of its own, which is how `movement/`
/// runs. With `autotests = false` a new directory runs only if `Cargo.toml` declares it, so every
/// directory here except `common/` must be a declared `[[test]]` path.
#[test]
fn every_test_directory_is_a_declared_program() {
    let manifest = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    let cargo_toml =
        std::fs::read_to_string(manifest.join("Cargo.toml")).expect("Cargo.toml reads");
    let mut missing: Vec<String> = std::fs::read_dir(manifest.join("tests"))
        .expect("the tests directory reads")
        .map(|entry| entry.expect("a directory entry").path())
        .filter(|path| path.is_dir())
        .filter_map(|path| Some(path.file_name()?.to_str()?.to_owned()))
        .filter(|dir| dir != "common")
        .filter(|dir| !cargo_toml.contains(&format!("path = \"tests/{dir}/main.rs\"")))
        .collect();
    missing.sort();
    assert!(
        missing.is_empty(),
        "these directories in crates/core/tests/ are not a [[test]] in crates/core/Cargo.toml and would never run: {missing:?}"
    );
}
