/**
 * Where a player reports a bug or asks for a feature.
 *
 * `/issues/new` rather than `/issues`: the call to action is "describe it", so the form is the
 * right target rather than a list to hunt through. The desktop capability scopes
 * `opener:allow-open-url` to `https://github.com/rmstdope/atlantis-hud/*`, so this address is
 * already inside the allowance and no capability change is needed - one that drifts outside it
 * would be refused at runtime rather than opened.
 */
export const ISSUES_URL = "https://github.com/rmstdope/atlantis-hud/issues/new";
