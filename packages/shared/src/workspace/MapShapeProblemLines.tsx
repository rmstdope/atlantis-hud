import type { MapShapeProblem } from "../mapShape";

/**
 * The reasons a map's wrapping cannot be drawn, one line each.
 *
 * Shared by the create screen and Settings > Per game so the two forms cannot drift apart in what
 * they say - the navigator's whole objection to the alternatives was that two identical-looking
 * forms would behave differently. Only the testid prefix differs, so each form's own test can name
 * its lines.
 */
export function MapShapeProblemLines({
  problems,
  testidPrefix
}: {
  problems: MapShapeProblem[];
  testidPrefix: string;
}) {
  return (
    <>
      {problems.map((problem) => (
        <span
          key={problem.axis}
          data-testid={`${testidPrefix}-${problem.axis}`}
          role="alert"
          className="text-danger"
        >
          {problem.message}
        </span>
      ))}
    </>
  );
}
