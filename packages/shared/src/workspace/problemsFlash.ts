import type { OrderDiagnostic } from "@atlantis/core-client";

/**
 * The line of a landing hex's Problems that `Show problems in <hex>` flashes (`ah-zjcj`), as an
 * index into `problems`, or null when there is none.
 *
 * It is the hex's own silver shortfall - no unit, code `not-enough-silver` - carrying the clause
 * the core adds for passengers sailing in to study there (`arriving_study_clause`, `ah-1uja`).
 * Every form of that clause ends "arriving by sea", including the one past three passengers that
 * names none of them, so the passenger is found in its line whichever form it took. A hex whose
 * shortfall has gone by the time the button is pressed has no such line, and nothing flashes.
 *
 * A rule kept out of the component that runs it, since this package cannot test an effect
 * (`testing/README.md`).
 */
export function problemToFlash(problems: readonly OrderDiagnostic[]): number | null {
  const index = problems.findIndex(
    (problem) =>
      problem.code === "not-enough-silver" &&
      problem.unitId === null &&
      problem.message.includes("arriving by sea")
  );
  return index === -1 ? null : index;
}
