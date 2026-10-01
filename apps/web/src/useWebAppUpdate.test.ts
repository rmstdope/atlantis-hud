import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRegisterSW } from "virtual:pwa-register/react";
import type { AppUpdateControl } from "@atlantis/shared";
import { useWebAppUpdate } from "./useWebAppUpdate";

vi.mock("virtual:pwa-register/react", () => ({
  useRegisterSW: vi.fn()
}));

describe("useWebAppUpdate", () => {
  let workerState: ServiceWorkerState;
  let onStateChange: EventListener | undefined;
  let reload: ReturnType<typeof vi.fn>;
  let updateServiceWorker: ReturnType<typeof vi.fn>;
  let control: AppUpdateControl | undefined;

  const waitingWorker = {
    get state() {
      return workerState;
    },
    addEventListener: vi.fn((_type: string, listener: EventListener) => {
      onStateChange = listener;
    }),
    removeEventListener: vi.fn(),
    postMessage: vi.fn()
  } as unknown as ServiceWorker;

  const registration = { waiting: waitingWorker } as ServiceWorkerRegistration;

  function Probe() {
    control = useWebAppUpdate();
    return null;
  }

  beforeEach(() => {
    workerState = "installed";
    onStateChange = undefined;
    reload = vi.fn();
    updateServiceWorker = vi.fn();
    control = undefined;
    vi.stubGlobal("window", { location: { reload } });
    vi.mocked(useRegisterSW).mockImplementation((options) => {
      options?.onRegisteredSW?.("/sw.js", registration);
      return {
        needRefresh: [true, vi.fn()],
        offlineReady: [false, vi.fn()],
        updateServiceWorker
      };
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reloads after the waiting worker activates even when the page is not controlled", () => {
    renderToStaticMarkup(createElement(Probe));

    control?.apply?.();
    expect(updateServiceWorker).toHaveBeenCalledWith(true);
    expect(onStateChange).toBeDefined();

    workerState = "activated";
    onStateChange?.(new Event("statechange"));

    expect(reload).toHaveBeenCalledOnce();
  });

  it("reloads when the waiting worker is already activated as apply begins", () => {
    renderToStaticMarkup(createElement(Probe));
    workerState = "activated";

    control?.apply?.();

    expect(reload).toHaveBeenCalledOnce();
  });
});
