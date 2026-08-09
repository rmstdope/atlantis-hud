/**
 * The web shell's answer to "is there a newer version".
 *
 * A deployment replaces the files behind the service worker, and the worker notices on its next
 * check - but a tab that was already open goes on running the code it started with until something
 * tells it not to. That is what this exposes: the fact that a new build is waiting, and the button
 * that activates it.
 *
 * It lives in the web app rather than in `packages/shared` because `virtual:pwa-register/react`
 * exists only where `vite-plugin-pwa` is configured, and the desktop build deliberately has no
 * service worker at all.
 */

import type { AppUpdateControl, AppUpdateState } from "@atlantis/shared";
import { useCallback, useRef, useState } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";

export function useWebAppUpdate(): AppUpdateControl {
  // Kept so a manual check has something to call `update()` on. The hook hands it over once, when
  // registration succeeds, and never again.
  const registration = useRef<ServiceWorkerRegistration | undefined>(undefined);
  const [checked, setChecked] = useState(false);
  const [checking, setChecking] = useState(false);

  const {
    needRefresh: [needRefresh],
    updateServiceWorker
  } = useRegisterSW({
    onRegisteredSW: (_url, worker) => {
      registration.current = worker;
    }
  });

  const check = useCallback(() => {
    const worker = registration.current;
    if (!worker) {
      // No registration means no service worker took hold - a build served over plain HTTP, or a
      // browser with workers disabled. Saying so beats a button that quietly does nothing.
      setChecked(true);
      return;
    }

    setChecking(true);
    void worker
      .update()
      // Either outcome ends the same way: the state below reads `needRefresh` to decide whether
      // this found anything, and `update()` resolving tells us only that the question was asked.
      .catch(() => undefined)
      .finally(() => {
        setChecking(false);
        setChecked(true);
      });
  }, []);

  const state: AppUpdateState = needRefresh
    ? "available"
    : checking
      ? "checking"
      : checked
        ? "current"
        : "idle";

  return {
    state,
    check,
    apply: () => void updateServiceWorker(true)
  };
}
