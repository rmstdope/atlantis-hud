/**
 * The tag that puts a smoke test on the `desktop-shell` project, and on that project only (ah-r7kot).
 *
 * Opened in Chromium, the desktop bundle runs the same WebAssembly core, query worker, browser
 * storage and AppShell as the web bundle; the two App.tsx files differ only in the props they hand
 * AppShell. So a walk that needs nothing the desktop App.tsx passes differently is walked once, on
 * `web`, and `playwright.config.ts` keeps every test carrying this tag off `web`, and every test
 * carrying neither this nor `BOTH_SHELLS_TAG` off `desktop-shell`.
 *
 * A test earns the tag when it needs one of the desktop props: the save-dialog port, the New Age
 * and New Origins transports, or the orders uploader - in practice, anything that stubs
 * `__ATLANTIS_DESKTOP_PLUGINS__`. Say why in the spec, as `desktop-shell.spec.ts` does.
 */
export const DESKTOP_SHELL_TAG = "@desktop-shell";

/**
 * The tag that puts a smoke test on both projects.
 *
 * The desktop App.tsx passes an orders uploader and the New Origins transport whatever the
 * environment, so on a New Origins game - the ruleset a new game starts on - the desktop header
 * carries Send and Fetch, and the web header neither. A taller or wrapped header moves everything
 * below it: ah-etb0.2 broke the Badges and turn-messages popovers on `desktop-shell` alone, with
 * every `web` walk green. So a walk earns this tag when it asserts where something sits, or whether
 * it takes the pointer, in ground the header strip's height moves: the header and its popovers, the
 * map's chip strip, and the splitters beneath them.
 */
export const BOTH_SHELLS_TAG = "@both-shells";
