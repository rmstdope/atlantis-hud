/**
 * What "check for updates" means, on a platform this package is not allowed to know about.
 *
 * The two shells answer the question in genuinely different ways. The web build has a service
 * worker, so a new deployment is something the running page can discover and then apply to itself.
 * The desktop build has neither: this repository is private, so its releases are invisible to an
 * unauthenticated request, and there is no version to compare against. What it can do is open the
 * releases page in a browser the player is already signed into.
 *
 * Rather than teach the settings panel about either, both are expressed as this one control and
 * handed in by the shell - the same optional injection `registerBeforeQuit` uses, and for the same
 * reason: importing `@tauri-apps/api` here would put half a desktop shell in the web bundle.
 */

export const UPDATE_STATES = [
  "unsupported",
  "idle",
  "checking",
  "current",
  "available",
  "opened"
] as const;

export type AppUpdateState = (typeof UPDATE_STATES)[number];

export type AppUpdateControl = {
  state: AppUpdateState;
  /** Web: asks the service worker to look for a new build. Desktop: opens the releases page. */
  check: () => void;
  /** Web only, and only while a new version is waiting: activates it and reloads. */
  apply?: () => void;
};

export type UpdateAction = {
  label: string;
  /** Which of the control's two functions this button calls. */
  kind: "check" | "apply";
};

export type UpdatePresentation = {
  /** Prose under the button, or nothing when there is nothing worth saying. */
  message: string | null;
  /** The button, or nothing where no update path exists. */
  action: UpdateAction | null;
};

const CHECK: UpdateAction = { label: "Check for updates", kind: "check" };

/**
 * The panel's whole view of an update, derived rather than branched over at the point of render.
 *
 * `unsupported` is not a defensive case. The desktop bundle opened in a plain browser - which is
 * how `pnpm --filter @atlantis/desktop dev` and the Playwright desktop project both run it - has no
 * Tauri runtime to open a page with and no service worker to ask, and a button that silently does
 * nothing is worse than no button.
 */
export function updatePresentationFor(state: AppUpdateState): UpdatePresentation {
  switch (state) {
    case "unsupported":
      return { message: "Updates are not available in this build.", action: null };
    case "idle":
      return { message: null, action: CHECK };
    case "checking":
      return { message: "Checking…", action: CHECK };
    case "current":
      return { message: "You are on the latest version.", action: CHECK };
    case "available":
      return { message: "A new version is ready.", action: { label: "Reload to update", kind: "apply" } };
    case "opened":
      return { message: "Opened the releases page in your browser.", action: CHECK };
  }
}

/** The control a shell hands in when it has no way to check. */
export const UNSUPPORTED_UPDATES: AppUpdateControl = {
  state: "unsupported",
  check: () => undefined
};
