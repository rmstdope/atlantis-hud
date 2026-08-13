#[test]
fn unwrapper_reassembles_the_real_turn_71_report() {
    let source = include_str!("../../../tests/fixtures/reports/neworigins-3.0.0-g7-f95-t71.rep");
    let lines = atlantis_hud_core::report::unwrap::unwrap_lines(source);

    // Region headers sit at indent 0 and name a terrain, a coordinate and a province.
    let regions = lines
        .iter()
        .filter(|line| line.indent == 0 && line.text.contains(") in ") && line.marker().is_none())
        .filter(|line| {
            line.text
                .split_whitespace()
                .next()
                .is_some_and(|word| word.chars().all(|c| c.is_ascii_lowercase()))
        })
        .count();
    assert_eq!(regions, 11, "expected 11 visited regions");

    // No logical line may exceed what the game could have wrapped, unless it was reassembled.
    let unjoined_too_long = lines
        .iter()
        .filter(|line| line.line_start == line.line_end && line.text.len() > 71)
        .count();
    assert_eq!(unjoined_too_long, 0);

    let own = lines.iter().filter(|l| l.marker() == Some('*')).count();
    let foreign = lines.iter().filter(|l| l.marker() == Some('-')).count();
    let structures = lines.iter().filter(|l| l.marker() == Some('+')).count();
    println!(
        "own={own} foreign={foreign} structures={structures} logical={}",
        lines.len()
    );
    assert!(own > 0 && foreign > 0 && structures > 0);
}
