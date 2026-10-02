/**
 * What "is there a newer version" means, on a platform this package is not allowed to know about.
 *
 * The two shells answer the question in genuinely different ways. The web build has a service
 * worker, so a new deployment is something the running page can discover and then apply to itself.
 * The desktop build reads GitHub's latest published release - the repository is public, so no
 * sign-in is needed - compares it with the running version, and hands the download to a browser;
 * installing stays outside the app (ah-sw92).
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
  "opened",
  "failed"
] as const;

export type AppUpdateState = (typeof UPDATE_STATES)[number];

export type AppUpdateControl = {
  /**
   * What is happening, or the outcome of the last check. On the desktop this is independent of
   * `newerVersion`: a check can be running while a newer version is already known.
   */
  state: AppUpdateState;
  /** Web: asks the service worker to look for a new build. Desktop: asks GitHub. */
  check: () => void;
  /** Web only, and only while a new version is waiting: activates it and reloads. */
  apply?: () => void;
  /** Desktop only: the newer published version, while one exists. */
  newerVersion?: string;
  /**
   * Desktop only: opens the newer release's page in a browser. Its presence is what selects the
   * desktop's two-button section.
   */
  download?: () => void;
};

export type UpdateButton = {
  label: string;
  /** Which of the control's functions this button calls. */
  kind: "check" | "apply" | "download";
  disabled: boolean;
};

export type UpdatePresentation = {
  /** The amber notice, while a newer version exists: an emphasised first sentence, then the rest. */
  notice: { emphasis: string; rest: string } | null;
  /** The section's buttons, in order; none where no update path exists. */
  buttons: UpdateButton[];
  /** The line under the buttons, or nothing when there is nothing worth saying. */
  status: { text: string; tone: "soft" | "error" } | null;
};

const SOFT = (text: string) => ({ text, tone: "soft" as const });
const LATEST = SOFT("You are on the latest version.");

/**
 * The About tab's whole view of an update, derived rather than branched over at the point of render.
 *
 * `unsupported` is not a defensive case. The desktop bundle opened in a plain browser - which is
 * how `pnpm --filter @atlantis/desktop dev` and the Playwright desktop project both run it - has no
 * Tauri runtime to ask GitHub with and no service worker to ask, and a button that silently does
 * nothing is worse than no button.
 */
export function updatePresentationFor(
  control: AppUpdateControl,
  runningVersion: string
): UpdatePresentation {
  if (control.state === "unsupported") {
    return { notice: null, buttons: [], status: SOFT("Updates are not available in this build.") };
  }
  return control.download ? desktopPresentation(control, runningVersion) : webPresentation(control);
}

function webPresentation(control: AppUpdateControl): UpdatePresentation {
  if (control.state === "available") {
    return {
      notice: { emphasis: "A new version is ready.", rest: "Reload to start using it." },
      buttons: [{ label: "Reload to update", kind: "apply", disabled: false }],
      status: null
    };
  }
  const status =
    control.state === "checking" ? SOFT("Checking…") : control.state === "current" ? LATEST : null;
  return {
    notice: null,
    buttons: [{ label: "Check for updates", kind: "check", disabled: false }],
    status
  };
}

function desktopPresentation(control: AppUpdateControl, runningVersion: string): UpdatePresentation {
  const newer = control.newerVersion;
  const checking = control.state === "checking";
  const buttons: UpdateButton[] = [
    newer
      ? { label: `Download ${newer}`, kind: "download", disabled: false }
      : { label: "Download update", kind: "download", disabled: true },
    { label: checking ? "Checking…" : "Check now", kind: "check", disabled: checking }
  ];

  let status: UpdatePresentation["status"] = null;
  if (control.state === "current") status = LATEST;
  if (control.state === "opened") status = SOFT("Opened the download page in your browser.");
  if (control.state === "failed") {
    status = {
      text: "Couldn't reach GitHub to check for updates. Try again later.",
      tone: "error"
    };
  }

  return {
    notice: newer
      ? { emphasis: `Version ${newer} is available.`, rest: `You have ${runningVersion}.` }
      : null,
    buttons,
    status
  };
}

export type UpdateMark = {
  /** Whether the amber dot sits on the settings button and the About tab. */
  marked: boolean;
  /** The settings button's tooltip and accessible name. */
  settingsLabel: string;
};

export const NO_UPDATE_MARK: UpdateMark = { marked: false, settingsLabel: "Settings" };

/** The mark a newer version leaves on the settings button and the About tab, in both shells. */
export function updateMarkFor(control: AppUpdateControl): UpdateMark {
  if (control.newerVersion) {
    return { marked: true, settingsLabel: `Settings — version ${control.newerVersion} is available` };
  }
  if (control.state === "available") {
    return { marked: true, settingsLabel: "Settings — a new version is available" };
  }
  return NO_UPDATE_MARK;
}

/** The control a shell hands in when it has no way to check. */
export const UNSUPPORTED_UPDATES: AppUpdateControl = {
  state: "unsupported",
  check: () => undefined
};
