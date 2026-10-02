/**
 * The desktop shell's answer to "is there a newer version" (ah-sw92).
 *
 * It reads GitHub's latest published release - the repository is public, so the request needs no
 * sign-in - at startup and then every hour, and compares it with the running version. A newer one
 * is offered as a link to that release's own page, opened in a browser: installing stays outside
 * the app.
 *
 * An automatic check that fails says nothing at all, and the next hourly one tries again; only a
 * check the player started reports a failure. An offline laptop should not nag.
 *
 * The rule is plain functions - `readLatestRelease`, `reduceDesktopUpdate` - so its tests need no
 * React; the hook at the bottom only wires them to a timer and to Tauri. This lives in the desktop
 * app rather than in `packages/shared` for the reason `quitGuard.ts` gives: importing
 * `@tauri-apps/api` from shared code would put half a desktop shell in the web bundle.
 */

import type { AppUpdateControl, AppUpdateState, HttpReply } from "@atlantis/shared";
import { APP_VERSION, UNSUPPORTED_UPDATES } from "@atlantis/shared";
import { useCallback, useEffect, useReducer, useRef } from "react";
import { hasTauriRuntime } from "./desktopCore";
import { desktopPlugins } from "./desktopPlugins";
import { openExternalOnDesktop } from "./openExternal";

/**
 * Where releases are published.
 *
 * The capability file scopes `opener:allow-open-url` to this repository, so a URL that drifts from
 * it is refused at runtime rather than opened.
 */
export const RELEASES_URL = "https://github.com/rmstdope/atlantis-hud/releases";

/**
 * The newest published release - drafts and prereleases excluded by GitHub. The capability file
 * lets the http plugin reach exactly this address on GitHub's API.
 */
export const LATEST_RELEASE_URL =
  "https://api.github.com/repos/rmstdope/atlantis-hud/releases/latest";

const HOUR_MS = 60 * 60 * 1000;
const CHECK_TIMEOUT_MS = 20_000;

/**
 * A release's own page, built from our constant rather than taken from the reply's `html_url`, so
 * it always lies inside the opener's scope.
 */
export function releasePageUrl(tag: string): string {
  return `${RELEASES_URL}/tag/${encodeURIComponent(tag)}`;
}

const VERSION = /^v?(\d+)\.(\d+)\.(\d+)$/;

/** Positive when `a` is newer, negative when older, zero when equal; null when either is not X.Y.Z. */
export function compareVersions(a: string, b: string): number | null {
  const left = VERSION.exec(a);
  const right = VERSION.exec(b);
  if (!left || !right) return null;
  for (let part = 1; part <= 3; part += 1) {
    const difference = Number(left[part]) - Number(right[part]);
    if (difference !== 0) return difference;
  }
  return 0;
}

export type FoundRelease = { version: string; url: string };

/**
 * What GitHub's reply says: a newer release, nothing newer, or a check that did not work.
 *
 * A build with no comparable version - `dev`, where no version was substituted - never counts a
 * release as newer: there is nothing to compare it with, and a dot on every development build would
 * be noise.
 */
export function readLatestRelease(reply: HttpReply, running: string): FoundRelease | null | "failed" {
  if (reply.status !== 200) return "failed";
  let tag: unknown;
  try {
    tag = (JSON.parse(reply.body) as { tag_name?: unknown }).tag_name;
  } catch {
    return "failed";
  }
  if (typeof tag !== "string" || !VERSION.test(tag)) return "failed";
  const version = tag.replace(/^v/, "");
  const order = compareVersions(version, running);
  return order !== null && order > 0 ? { version, url: releasePageUrl(tag) } : null;
}

export type DesktopUpdate = {
  /** The newer release, while one is known. */
  newer: FoundRelease | null;
  checking: boolean;
  /** What the status line says once no check is running. */
  outcome: "idle" | "current" | "failed" | "opened";
};

export type DesktopUpdateEvent =
  | { type: "started" }
  | { type: "found"; release: FoundRelease | null }
  | { type: "failed"; manual: boolean }
  | { type: "opened" };

/** Before the first check has finished: nothing newer, nothing said. */
export const INITIAL_DESKTOP_UPDATE: DesktopUpdate = { newer: null, checking: false, outcome: "idle" };

export function reduceDesktopUpdate(state: DesktopUpdate, event: DesktopUpdateEvent): DesktopUpdate {
  switch (event.type) {
    case "started":
      return { ...state, checking: true };
    case "found":
      return {
        newer: event.release,
        checking: false,
        outcome: event.release ? "idle" : "current"
      };
    case "failed":
      // Silence for an automatic check is deliberate: whatever was on screen stays.
      return event.manual
        ? { newer: null, checking: false, outcome: "failed" }
        : { ...state, checking: false };
    case "opened":
      return { ...state, outcome: "opened" };
  }
}

/** The control's `state` for a desktop update: a running check wins over the last outcome. */
export function desktopUpdateState(state: DesktopUpdate): AppUpdateState {
  return state.checking ? "checking" : state.outcome;
}

async function fetchLatestRelease(): Promise<FoundRelease | null | "failed"> {
  const plugins = desktopPlugins();
  if (!plugins) return "failed";
  // A controller and a timer rather than `AbortSignal.timeout`, which WebKit gained only in Safari
  // 16 - and the shell supports macOS 10.15, whose webview is older than that.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
  try {
    const reply = await plugins.httpRequest(
      {
        method: "GET",
        url: LATEST_RELEASE_URL,
        headers: { Accept: "application/vnd.github+json", "User-Agent": "atlantis-hud" }
      },
      controller.signal
    );
    return readLatestRelease(reply, APP_VERSION);
  } finally {
    clearTimeout(timer);
  }
}

export function useDesktopAppUpdate(): AppUpdateControl {
  const [update, dispatch] = useReducer(reduceDesktopUpdate, INITIAL_DESKTOP_UPDATE);
  // A ref rather than `update.checking`, so a timer tick and a press in the same moment cannot
  // start two requests.
  const inFlight = useRef(false);
  const supported = hasTauriRuntime();

  const runCheck = useCallback((manual: boolean) => {
    if (inFlight.current) return;
    inFlight.current = true;
    dispatch({ type: "started" });
    void fetchLatestRelease()
      .catch(() => "failed" as const)
      .then((result) => {
        dispatch(
          result === "failed" ? { type: "failed", manual } : { type: "found", release: result }
        );
      })
      .finally(() => {
        inFlight.current = false;
      });
  }, []);

  useEffect(() => {
    if (!supported) return;
    runCheck(false);
    const timer = setInterval(() => runCheck(false), HOUR_MS);
    return () => clearInterval(timer);
  }, [supported, runCheck]);

  const check = useCallback(() => runCheck(true), [runCheck]);
  const url = update.newer?.url;
  const download = useCallback(() => {
    if (!url) return;
    openExternalOnDesktop(url);
    dispatch({ type: "opened" });
  }, [url]);

  // Opened in a plain browser - `pnpm --filter @atlantis/desktop dev`, and the Playwright desktop
  // project - there is no runtime to ask GitHub through. Saying so beats a button that does nothing.
  if (!supported) {
    return UNSUPPORTED_UPDATES;
  }

  return {
    state: desktopUpdateState(update),
    check,
    download,
    newerVersion: update.newer?.version
  };
}
