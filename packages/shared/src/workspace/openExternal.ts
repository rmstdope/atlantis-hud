/**
 * How this shell hands a URL to something that can open it.
 *
 * The same optional injection `AppUpdateControl` uses, and for the same reason: importing
 * `@tauri-apps/api` here would put half a desktop shell in the web bundle. A plain `<a href>` is
 * not an alternative - it works in a browser and does the wrong thing inside the Tauri webview,
 * where a link has to be handed to the operating system rather than followed in place.
 */
export type OpenExternal = (url: string) => void;

/** The web shell's answer, and the default when no shell supplies one. */
export const OPEN_EXTERNAL_IN_NEW_TAB: OpenExternal = (url) => {
  window.open(url, "_blank", "noopener,noreferrer");
};
