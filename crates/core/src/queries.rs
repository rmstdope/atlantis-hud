//! The core's stateless queries, declared once for both shells (ah-w83n).
//!
//! Each entry below is a query the UI may ask of the core: its name, its parameters, what it
//! answers and how. From this one declaration come
//!
//! - a plain Rust function of the same name, for the core's own callers and tests;
//! - [`QUERY_NAMES`], every declared name;
//! - [`answer`], which decodes a query's arguments from any serde `Deserializer` as a positional
//!   sequence and streams its answer into any serde `Serializer`. The desktop's one `query` Tauri
//!   command and the browser's one `query` wasm export are thin calls into it, so neither shell is
//!   edited when a query is added;
//! - under `cargo test`, the TypeScript signatures in
//!   `packages/core-client/src/generated/CoreQueries.ts`, from which both TypeScript adapters derive
//!   their methods.
//!
//! Adding a query is therefore the core function, one entry here, `cargo test -p atlantis-hud-core
//! --lib export_bindings_` to regenerate the TypeScript, and the caller. A query belongs here when
//! it needs nothing from either shell (no database, no games directory) and its parameter and
//! answer types are ts-rs bindings; anything shell-specific stays a hand-written command.
//!
//! Every body answers `Result<_, String>`: an `Err` is how both shells reject, and one shape keeps
//! the dispatcher uniform. An infallible query writes `Ok(..)`.

use std::sync::Arc;

use serde::{Deserialize, Deserializer};

use crate::cache::with_global;
use crate::movement::passages::PassageClaim;
use crate::orders::effects::OrdersPreviewResponse;
use crate::orders::request::{PreviewOrdersRequest, ValidateOrdersRequest};
use crate::orders::shelter::ShelterSeat;
use crate::report::battle::RosterSkills;
use crate::report::ParsedReport;
use crate::{EngineInfo, OrderValidationResult};

/// Reads a query's positional arguments as the tuple of its declared parameter types.
///
/// A query without parameters reads nothing, so whatever a caller sends for it (`[]`, `null`) is
/// fine; a query with parameters must be sent exactly that many, in order.
fn decode<'de, T: Deserialize<'de>, D: Deserializer<'de>>(
    args: D,
    arity: usize,
) -> Result<T, String> {
    let decoded = if arity == 0 {
        drop(args);
        T::deserialize(serde::de::value::UnitDeserializer::<serde::de::value::Error>::new())
            .map_err(|error| error.to_string())
    } else {
        T::deserialize(args).map_err(|error| error.to_string())
    };
    decoded.map_err(|error| format!("arguments could not be read: {error}"))
}

macro_rules! core_queries {
    ($(
        $(#[doc = $doc:literal])*
        $name:ident ( $($arg:ident : $ty:ty),* $(,)? ) -> $ret:ty $body:block
    )*) => {
        $(
            $(#[doc = $doc])*
            ///
            /// # Errors
            ///
            /// Declared in [`crate::queries`]; the error is the query's own refusal.
            pub fn $name($($arg: $ty),*) -> Result<$ret, String> $body
        )*

        /// Every declared query, by the name a shell asks for it under, in declaration order.
        pub const QUERY_NAMES: &[&str] = &[$(stringify!($name)),*];

        /// Answers the query called `name`: its arguments decoded from `args` as a positional
        /// sequence, its answer serialized into `out`.
        ///
        /// # Errors
        ///
        /// `unknown core query "<name>"` for a name nobody declared; `arguments could not be read:
        /// …` for arguments of the wrong number or shape; otherwise the query's own refusal, or the
        /// serializer's.
        pub fn answer<'de, D, S>(name: &str, args: D, out: S) -> Result<S::Ok, String>
        where
            D: Deserializer<'de>,
            S: serde::Serializer,
        {
            match name {
                $(
                    stringify!($name) => {
                        let ($($arg,)*): ($($ty,)*) =
                            decode(args, <[&str]>::len(&[$(stringify!($arg)),*]))?;
                        serde::Serialize::serialize(&$name($($arg),*)?, out)
                            .map_err(|error| error.to_string())
                    }
                )*
                _ => Err(format!("unknown core query \"{name}\"")),
            }
        }

        /// What `CoreQueries.ts` says of each query: read off the declaration's own types by
        /// ts-rs, so the TypeScript signature cannot drift from the Rust one.
        #[cfg(test)]
        pub(crate) fn signatures(cfg: &ts_rs::Config) -> Vec<QuerySignature> {
            vec![$(
                QuerySignature {
                    name: stringify!($name),
                    doc: vec![$($doc),*],
                    params: vec![$((stringify!($arg), <$ty as ts_rs::TS>::name(cfg))),*],
                    result: <$ret as ts_rs::TS>::name(cfg),
                    imports: {
                        let mut imports = Imports { cfg, found: std::collections::BTreeMap::new() };
                        $(ts_rs::TypeVisitor::visit::<$ty>(&mut imports);)*
                        ts_rs::TypeVisitor::visit::<$ret>(&mut imports);
                        imports.found
                    },
                }
            ),*]
        }
    };
}

core_queries! {
    /// Canonical engine metadata.
    get_engine_info() -> EngineInfo {
        Ok(crate::engine_info())
    }

    /// Every combat skill the report's battle rosters disclosed, in report order.
    ///
    /// Deliberately **not** through the cache: the only caller is a scan over many stored turns,
    /// and the cache holds one report, so going through it would evict the player's open turn on
    /// every iteration and make the next order-validation keystroke re-parse it.
    roster_skills(raw_report: String) -> Vec<RosterSkills> {
        Ok(crate::report::battle::roster_skills(
            &crate::report::parse_report_full(&raw_report).battles,
        ))
    }

    /// Every crossing of an inner passage this turn's own orders claim.
    ///
    /// Deliberately **not** through the cache, for the reason `roster_skills` gives. The ruleset is
    /// taken because an orders document is read against a world's own comment syntax
    /// (`ah-g9sf.3`); one that will not parse falls back to `None`.
    passage_claims(raw_report: String, orders_document: String, ruleset_json: String) -> Vec<PassageClaim> {
        let report = crate::report::parse_report_full(&raw_report);
        let ruleset = crate::movement::rules::Ruleset::from_json(&ruleset_json).ok();
        let ordered =
            crate::movement::fleet::OrderedUnits::from_document(&orders_document, ruleset.as_ref());
        Ok(crate::movement::passages::passage_claims(&report, &ordered))
    }

    /// How many mages each structure in the report seats - the study planner's shelters, from the
    /// one rule the magic-study check reads (ah-29p5). `seats` is null where the catalogue cannot
    /// say. Rejects only when the ruleset cannot be read.
    shelter_seats(raw_report: String, ruleset_json: String) -> Vec<ShelterSeat> {
        with_global(|cache| crate::orders::shelter::shelter_seats_in(cache, &raw_report, &ruleset_json))
    }

    /// Parses a report and counts each unit's men against the catalogue, through the cache every
    /// other query uses, so the planner and the validator that follow re-parse nothing.
    parse_report_classified(raw_report: String, ruleset_json: String) -> Arc<ParsedReport> {
        Ok(with_global(|cache| {
            crate::movement::request::parse_and_classify(cache, &raw_report, &ruleset_json)
        }))
    }

    /// Validates one draft of orders and returns structured diagnostics.
    ///
    /// With the request's report the answer covers the checks that read what each unit holds and
    /// where it stands; without one it is the syntax check alone. The report goes through the
    /// cache, so the whole-map pass this runs on each keystroke re-parses nothing.
    validate_orders(request: ValidateOrdersRequest) -> OrderValidationResult {
        Ok(with_global(|cache| {
            crate::orders::request::validate_orders_request(cache, &request)
        }))
    }

    /// Every order name, so the shell need not keep a copy of its own.
    order_commands(ruleset_json: Option<String>) -> Vec<String> {
        let ruleset =
            with_global(|cache| ruleset_json.as_deref().and_then(|json| cache.ruleset(json).ok()));
        Ok(crate::order_commands(ruleset.as_deref())
            .into_iter()
            .map(str::to_string)
            .collect())
    }

    /// Every word the rules know, for the editor that has to spot a keyword as it is typed.
    order_vocabulary(ruleset_json: Option<String>) -> Vec<String> {
        let ruleset =
            with_global(|cache| ruleset_json.as_deref().and_then(|json| cache.ruleset(json).ok()));
        Ok(crate::order_vocabulary(ruleset.as_deref()))
    }

    /// The known map inside one rectangle, written out as report-shaped text, byte for byte the
    /// same on either shell. Rejects when the remembered regions or the request cannot be read; an
    /// empty rectangle is a header and no regions.
    export_map(raw_report: String, remembered_json: String, request_json: String) -> String {
        with_global(|cache| {
            crate::report::export::export_map_text(cache, &raw_report, &remembered_json, &request_json)
        })
    }

    /// Every named unit written out as a report fragment an ally can read back. Rejects when the
    /// unit ids cannot be read; an empty list is a header and no units.
    export_mage_sheet(raw_report: String, unit_ids_json: String) -> String {
        with_global(|cache| {
            crate::report::export::export_mage_sheet_text(cache, &raw_report, &unit_ids_json)
        })
    }

    /// What the orders document makes of the faction's units, region by region. Rejects only when
    /// the ruleset or the remembered regions cannot be read; orders that change nothing are an
    /// empty answer.
    preview_orders(request: PreviewOrdersRequest) -> OrdersPreviewResponse {
        with_global(|cache| crate::orders::request::preview_orders_request(cache, &request))
    }
}

/// One query as `CoreQueries.ts` declares it.
#[cfg(test)]
pub(crate) struct QuerySignature {
    name: &'static str,
    /// The declaration's doc comment, one literal per line, as rustdoc hands it over.
    doc: Vec<&'static str>,
    /// Each parameter's Rust name and TypeScript type.
    params: Vec<(&'static str, String)>,
    result: String,
    /// Import path to the one type each generated file exports.
    imports: std::collections::BTreeMap<String, String>,
}

/// Collects the generated types a signature names, together with their import paths.
#[cfg(test)]
struct Imports<'a> {
    cfg: &'a ts_rs::Config,
    found: std::collections::BTreeMap<String, String>,
}

#[cfg(test)]
impl ts_rs::TypeVisitor for Imports<'_> {
    fn visit<T: ts_rs::TS + 'static + ?Sized>(&mut self) {
        if let Some(dependency) = ts_rs::Dependency::from_ty::<T>(self.cfg) {
            // Relative to the export directory, which is where `CoreQueries.ts` itself is written.
            let path = dependency.output_path.to_string_lossy().replace('\\', "/");
            let path = path.trim_end_matches(".ts");
            let path = if path.starts_with("../") {
                path.to_owned()
            } else {
                format!("./{path}")
            };
            self.found.insert(path, dependency.ts_name);
        }
        T::visit_generics(self);
    }
}

#[cfg(test)]
fn camel_case(snake: &str) -> String {
    let mut camel = String::with_capacity(snake.len());
    let mut upper = false;
    for character in snake.chars() {
        if character == '_' {
            upper = true;
        } else if upper {
            camel.extend(character.to_uppercase());
            upper = false;
        } else {
            camel.push(character);
        }
    }
    camel
}

/// The text of `CoreQueries.ts`: the type both TypeScript adapters implement, and the name table
/// they build their methods from.
#[cfg(test)]
fn render_typescript(signatures: &[QuerySignature]) -> String {
    let mut imports = std::collections::BTreeMap::new();
    for signature in signatures {
        imports.extend(
            signature
                .imports
                .iter()
                .map(|(path, name)| (path.clone(), name.clone())),
        );
    }

    let mut out = String::from(
        "// This file was generated from crates/core/src/queries.rs. Do not edit this file manually.\n\
         // Regenerate it with: cargo test -p atlantis-hud-core --lib export_bindings_\n",
    );
    for (path, name) in &imports {
        out.push_str(&format!("import type {{ {name} }} from \"{path}\";\n"));
    }
    out.push_str(
        "\n/** The core's stateless queries, one method each, answered alike on both shells. */\n\
         export type CoreQueries = {\n",
    );
    for signature in signatures {
        if !signature.doc.is_empty() {
            out.push_str("  /**\n");
            for line in &signature.doc {
                let line = line.strip_prefix(' ').unwrap_or(line);
                if line.is_empty() {
                    out.push_str("   *\n");
                } else {
                    out.push_str(&format!("   * {line}\n"));
                }
            }
            out.push_str("   */\n");
        }
        let params = signature
            .params
            .iter()
            .map(|(name, ty)| format!("{}: {ty}", camel_case(name)))
            .collect::<Vec<_>>()
            .join(", ");
        out.push_str(&format!(
            "  {}({params}): Promise<{}>;\n",
            camel_case(signature.name),
            signature.result
        ));
    }
    out.push_str(
        "};\n\n/** The name each `CoreQueries` method is asked for under, on either shell. */\n\
         export const CORE_QUERIES = {\n",
    );
    let rows = signatures
        .iter()
        .map(|signature| format!("  {}: \"{}\"", camel_case(signature.name), signature.name))
        .collect::<Vec<_>>()
        .join(",\n");
    out.push_str(&rows);
    out.push_str("\n} as const;\n");
    out
}

/// Writes `CoreQueries.ts` beside the ts-rs bindings.
///
/// Named `export_bindings_…` so the one regenerate command (`cargo test -p atlantis-hud-core --lib
/// export_bindings_`) and `scripts/checkGenerated.ts` already cover it; it reads the same
/// `TS_RS_EXPORT_DIR` ts-rs does, which `export_bindings_stay_inside_this_workspace` guards.
#[test]
fn export_bindings_core_queries() {
    let dir = std::env::var("TS_RS_EXPORT_DIR").expect("TS_RS_EXPORT_DIR, from .cargo/config.toml");
    std::fs::create_dir_all(&dir).expect("the export directory");
    let text = render_typescript(&signatures(&ts_rs::Config::from_env()));
    std::fs::write(std::path::Path::new(&dir).join("CoreQueries.ts"), text).expect("written");
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn a_report_with_two_structures() -> String {
        let mut report = String::from("Foo (1) Report\n\n");
        report.push_str("plain (1,1) in Coast, 10 peasants (orcs), $5.\n\n");
        report.push_str("Exits:\n  North : plain (1,-1) in Coast.\n\n");
        report.push_str("+ Keep [1] : Citadel.\n");
        report.push_str("+ Ark [2] : Galleon.\n");
        report
    }

    fn ask(name: &str, args: serde_json::Value) -> Result<serde_json::Value, String> {
        answer(name, args, serde_json::value::Serializer)
    }

    #[test]
    fn answers_a_declared_query_with_what_the_core_function_returns() {
        let report = a_report_with_two_structures();
        let ruleset = atlantis_hud_fixtures::RULESET_JSON;

        let answered = ask("shelter_seats", json!([report, ruleset])).expect("answered");

        let direct = crate::cache::with_global(|cache| {
            crate::orders::shelter::shelter_seats_in(cache, &report, ruleset)
        })
        .expect("a usable ruleset");
        assert_eq!(answered, serde_json::to_value(direct).expect("serializes"));
    }

    #[test]
    fn refuses_an_undeclared_query_by_name() {
        assert_eq!(
            ask("no_such_query", json!([])),
            Err("unknown core query \"no_such_query\"".to_owned())
        );
    }

    #[test]
    fn refuses_arguments_of_the_wrong_arity() {
        let error = ask("shelter_seats", json!(["only the report"])).expect_err("refused");
        assert!(!error.starts_with("unknown core query"), "{error}");

        let error = ask("shelter_seats", json!(["a", "b", "c"])).expect_err("refused");
        assert!(!error.starts_with("unknown core query"), "{error}");
    }

    #[test]
    fn answers_a_query_without_parameters_whatever_args_it_is_given() {
        let expected = serde_json::to_value(crate::engine_info()).expect("serializes");

        assert_eq!(ask("get_engine_info", json!([])), Ok(expected.clone()));
        assert_eq!(ask("get_engine_info", json!(null)), Ok(expected));
    }

    #[test]
    fn passes_a_query_s_own_error_through() {
        let error =
            ask("shelter_seats", json!(["Foo (1) Report\n", "not json"])).expect_err("refused");
        assert!(!error.starts_with("unknown core query"), "{error}");
        assert!(!error.starts_with("arguments"), "{error}");
    }

    #[test]
    fn names_every_declared_query_once() {
        let mut names = QUERY_NAMES.to_vec();
        names.sort_unstable();
        names.dedup();
        assert_eq!(names.len(), QUERY_NAMES.len());
        assert!(QUERY_NAMES.contains(&"shelter_seats"));
    }
}

#[cfg(test)]
mod typescript_tests {
    use super::*;

    fn a_signature() -> QuerySignature {
        QuerySignature {
            name: "shelter_seats",
            doc: vec![
                " How many mages each structure seats.",
                "",
                " `seats` is null.",
            ],
            params: vec![
                ("raw_report", "string".to_owned()),
                ("ruleset_json", "string | null".to_owned()),
            ],
            result: "Array<ShelterSeat>".to_owned(),
            imports: [("./ShelterSeat".to_owned(), "ShelterSeat".to_owned())]
                .into_iter()
                .collect(),
        }
    }

    #[test]
    fn renders_a_query_as_a_typed_promise_and_a_name_row() {
        let rendered = render_typescript(&[a_signature()]);

        assert_eq!(
            rendered,
            [
                "// This file was generated from crates/core/src/queries.rs. Do not edit this file manually.",
                "// Regenerate it with: cargo test -p atlantis-hud-core --lib export_bindings_",
                "import type { ShelterSeat } from \"./ShelterSeat\";",
                "",
                "/** The core's stateless queries, one method each, answered alike on both shells. */",
                "export type CoreQueries = {",
                "  /**",
                "   * How many mages each structure seats.",
                "   *",
                "   * `seats` is null.",
                "   */",
                "  shelterSeats(rawReport: string, rulesetJson: string | null): Promise<Array<ShelterSeat>>;",
                "};",
                "",
                "/** The name each `CoreQueries` method is asked for under, on either shell. */",
                "export const CORE_QUERIES = {",
                "  shelterSeats: \"shelter_seats\"",
                "} as const;",
                "",
            ]
            .join("\n")
        );
    }

    #[test]
    fn imports_every_generated_type_a_signature_names_once() {
        let cfg = ts_rs::Config::from_env();
        let signatures = signatures(&cfg);

        let shelter = signatures
            .iter()
            .find(|signature| signature.name == "shelter_seats")
            .expect("declared");
        assert_eq!(shelter.result, "Array<ShelterSeat>");
        assert_eq!(
            shelter.imports.iter().collect::<Vec<_>>(),
            vec![(&"./ShelterSeat".to_owned(), &"ShelterSeat".to_owned())]
        );

        let classified = signatures
            .iter()
            .find(|signature| signature.name == "parse_report_classified")
            .expect("declared");
        assert_eq!(classified.result, "ParsedReport");
        assert!(classified.imports.contains_key("./ParsedReport"));

        let commands = signatures
            .iter()
            .find(|signature| signature.name == "order_commands")
            .expect("declared");
        assert_eq!(
            commands.params,
            vec![("ruleset_json", "string | null".to_owned())]
        );
        assert!(commands.imports.is_empty());
    }
}
