/**
 * What an exhaustive runner prints and exits with, once every leg has already run.
 *
 * Two runners here make the same trade - `runSuites.ts` over the test suites, `runGate.ts` over the
 * fast gate - and for the same reason: an `&&` chain lets an early failure hide whether the later
 * legs ran at all. They share this reporter so the two outputs cannot drift apart, and so the
 * shape is stated once.
 *
 * Pure, so the cases are plain.
 */

/**
 * `detail` is a leg's own inner verdict, quoted rather than judged - `runGate.ts` uses it to name
 * which test suite failed without becoming a second reporter over the suites.
 */
export type LegResult = { name: string; passed: boolean; skipped?: boolean; detail?: string };

/** SKIP wins over PASS/FAIL: a skipped leg never ran, so it neither passed nor failed. */
export function verdictWord(result: LegResult): string {
  if (result.skipped === true) return "SKIP";
  return result.passed ? "PASS" : "FAIL";
}

/**
 * The line every leg appears in, and the verdict under it when any of them failed.
 *
 * `label` opens the line ("suites", "gate"); `noun` is what the failing ones are called underneath
 * ("suites", "legs"), which is not always the same word.
 */
export function summarizeLegs(
  label: string,
  noun: string,
  results: readonly LegResult[]
): { exitCode: number; text: string } {
  const line = `${label}: ${results
    .map(
      (result) =>
        `${result.name} ${verdictWord(result)}${
          result.detail === undefined ? "" : ` (${result.detail})`
        }`
    )
    .join("  ")}`;
  const failed = results.filter((result) => result.skipped !== true && !result.passed);

  if (failed.length === 0) {
    return { exitCode: 0, text: line };
  }

  const names = failed.map((result) => result.name).join(", ");
  return {
    exitCode: 1,
    text: `${line}\n${failed.length} of ${results.length} ${noun} failed: ${names}`
  };
}
