import type { AdvisoryChecks } from "../settingsStore";

/**
 * Everything order validation reads, as the shell holds it (ah-119b).
 *
 * Validation is debounced and answered by the core's worker, so the answer on screen can be for
 * inputs that have since moved. Keeping the inputs an answer was for beside the answer is what lets
 * the page say whether it is current - a fact the smoke suite used to guess from the problem count,
 * whose `"0"` reads the same before validation runs as after (ah-qffa, ah-dlao, ah-f9q9).
 */
export interface ValidationInputs {
  readonly ordersDocument: string;
  readonly rulesetText: string | null;
  readonly rawReport: string;
  readonly advisoryChecks: AdvisoryChecks;
  readonly mapJson: string;
  readonly passagesJson: string;
  readonly rememberedJson: string;
}

/** `data-validation` on the turn-report chip: whether the shown answer is for the inputs now. */
export type ValidationMarker = "current" | "pending";

/**
 * `current` exactly when `answeredFor` holds the same values as `now`, field by field.
 *
 * `===` throughout, the settings object included: a new settings object is what re-runs the
 * validation, so it is a new question even when it says the same thing. Nothing answered yet
 * (`null`), and a validation that failed and so recorded nothing, both stay `pending`.
 */
export function validationMarker(
  answeredFor: ValidationInputs | null,
  now: ValidationInputs
): ValidationMarker {
  if (answeredFor === null) {
    return "pending";
  }
  const fields = Object.keys(now) as (keyof ValidationInputs)[];
  return fields.every((field) => answeredFor[field] === now[field]) ? "current" : "pending";
}
