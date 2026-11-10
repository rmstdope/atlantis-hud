/**
 * The request the HUD's orders preview is asked with.
 *
 * One builder, read by the preview the map and unit table draw and by the assistant's
 * `get_forecast`, so the assistant is answered under exactly the inputs the player's screen is
 * (`ah-a97xg.1`) rather than by two call sites kept in step by hand.
 */

import type { PreviewOrdersRequest } from "@atlantis/core-client";
import { disabledAdvisoryCodes, type AdvisoryChecks } from "./settingsStore";

/** Everything on screen the preview reads. */
export interface PreviewInputs {
  readonly rulesetText: string;
  readonly rawReport: string;
  readonly rememberedJson: string;
  /** The whole document, not one unit's block. */
  readonly ordersDocument: string;
  readonly mapJson: string;
  readonly passagesJson: string;
  readonly advisoryChecks: AdvisoryChecks;
}

export function previewOrdersRequest(inputs: PreviewInputs): PreviewOrdersRequest {
  return {
    rulesetJson: inputs.rulesetText,
    rawReport: inputs.rawReport,
    rememberedJson: inputs.rememberedJson,
    ordersDocument: inputs.ordersDocument,
    mapJson: inputs.mapJson,
    passagesJson: inputs.passagesJson,
    disabledCodes: disabledAdvisoryCodes(inputs.advisoryChecks)
  };
}
