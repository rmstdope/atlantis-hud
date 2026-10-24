/**
 * The tag that puts a smoke test on the `desktop-shell` project, and on that project only (ah-r7kot).
 *
 * Opened in Chromium, the desktop bundle runs the same WebAssembly core, query worker, browser
 * storage and AppShell as the web bundle; the two App.tsx files differ only in the props they hand
 * AppShell. So a walk that needs nothing the desktop App.tsx passes differently is walked once, on
 * `web`, and `playwright.config.ts` keeps every test carrying this tag off `web` and every test
 * without it off `desktop-shell`.
 *
 * A test earns the tag when it needs one of the desktop props: the save-dialog port, the New Age
 * and New Origins transports, or the orders uploader - in practice, anything that stubs
 * `__ATLANTIS_DESKTOP_PLUGINS__`. Say why in the spec, as `desktop-shell.spec.ts` does.
 */
export const DESKTOP_SHELL_TAG = "@desktop-shell";
