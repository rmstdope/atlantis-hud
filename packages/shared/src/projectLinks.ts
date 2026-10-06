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

/**
 * Where a player who wants to say thanks can buy the author a coffee - the About tab's support card.
 *
 * Opened in the player's own browser like the issues link, never loaded into the app: the button is
 * drawn here rather than from Buy Me a Coffee's script, so the tab works offline and nobody contacts
 * a third party by opening it. The desktop capability allows exactly this page, beside the
 * repository, for `opener:allow-open-url`.
 */
export const DONATE_URL = "https://www.buymeacoffee.com/rmstdope";
