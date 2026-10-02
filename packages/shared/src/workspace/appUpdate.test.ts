import { describe, expect, it } from "vitest";
import type { AppUpdateControl } from "./appUpdate";
import { UNSUPPORTED_UPDATES, updateMarkFor, updatePresentationFor } from "./appUpdate";

const noop = () => undefined;
const web = (state: AppUpdateControl["state"]): AppUpdateControl => ({
  state,
  check: noop,
  apply: noop
});
const desktop = (
  state: AppUpdateControl["state"],
  newerVersion?: string
): AppUpdateControl => ({ state, check: noop, download: noop, newerVersion });

describe("updatePresentationFor, in a build that cannot update", () => {
  it("offers no control, no notice, and says why", () => {
    expect(updatePresentationFor(UNSUPPORTED_UPDATES, "0.25.2")).toEqual({
      notice: null,
      buttons: [],
      status: { text: "Updates are not available in this build.", tone: "soft" }
    });
  });
});

describe("updatePresentationFor, on the web", () => {
  const check = { label: "Check for updates", kind: "check", disabled: false };

  it("rests on a single check button and no prose", () => {
    expect(updatePresentationFor(web("idle"), "0.25.2")).toEqual({
      notice: null,
      buttons: [check],
      status: null
    });
  });

  it("keeps the button pressable while a check runs, with the status under it", () => {
    expect(updatePresentationFor(web("checking"), "0.25.2")).toEqual({
      notice: null,
      buttons: [check],
      status: { text: "Checking…", tone: "soft" }
    });
  });

  it("reports that nothing is waiting", () => {
    expect(updatePresentationFor(web("current"), "0.25.2").status).toEqual({
      text: "You are on the latest version.",
      tone: "soft"
    });
  });

  it("turns into the reload notice once a new build is waiting", () => {
    expect(updatePresentationFor(web("available"), "0.25.2")).toEqual({
      notice: { emphasis: "A new version is ready.", rest: "Reload to start using it." },
      buttons: [{ label: "Reload to update", kind: "apply", disabled: false }],
      status: null
    });
  });
});

describe("updatePresentationFor, on the desktop", () => {
  const checkNow = { label: "Check now", kind: "check", disabled: false };
  const greyDownload = { label: "Download update", kind: "download", disabled: true };

  it("names both versions and offers that version's download beside Check now", () => {
    expect(updatePresentationFor(desktop("idle", "0.26.0"), "0.25.2")).toEqual({
      notice: { emphasis: "Version 0.26.0 is available.", rest: "You have 0.25.2." },
      buttons: [{ label: "Download 0.26.0", kind: "download", disabled: false }, checkNow],
      status: null
    });
  });

  it("greys the download out when nothing is newer, and says so", () => {
    expect(updatePresentationFor(desktop("current"), "0.25.2")).toEqual({
      notice: null,
      buttons: [greyDownload, checkNow],
      status: { text: "You are on the latest version.", tone: "soft" }
    });
  });

  it("says nothing before the first check has finished", () => {
    expect(updatePresentationFor(desktop("idle"), "0.25.2")).toEqual({
      notice: null,
      buttons: [greyDownload, checkNow],
      status: null
    });
  });

  it("reports a failed manual check in the error tone", () => {
    expect(updatePresentationFor(desktop("failed"), "0.25.2")).toEqual({
      notice: null,
      buttons: [greyDownload, checkNow],
      status: {
        text: "Couldn't reach GitHub to check for updates. Try again later.",
        tone: "error"
      }
    });
  });

  it("greys Check now while a check runs and leaves the download as it was", () => {
    const checking = { label: "Checking…", kind: "check", disabled: true };

    expect(updatePresentationFor(desktop("checking"), "0.25.2")).toEqual({
      notice: null,
      buttons: [greyDownload, checking],
      status: null
    });
    expect(updatePresentationFor(desktop("checking", "0.26.0"), "0.25.2").buttons).toEqual([
      { label: "Download 0.26.0", kind: "download", disabled: false },
      checking
    ]);
  });

  it("keeps the notice and confirms the handoff once the download page is opened", () => {
    const presentation = updatePresentationFor(desktop("opened", "0.26.0"), "0.25.2");

    expect(presentation.notice).not.toBeNull();
    expect(presentation.status).toEqual({
      text: "Opened the download page in your browser.",
      tone: "soft"
    });
  });
});

describe("updateMarkFor", () => {
  it("names the version on the settings button when the desktop knows it", () => {
    expect(updateMarkFor(desktop("idle", "0.26.0"))).toEqual({
      marked: true,
      settingsLabel: "Settings — version 0.26.0 is available"
    });
  });

  it("keeps the mark while a later check runs", () => {
    expect(updateMarkFor(desktop("checking", "0.26.0")).marked).toBe(true);
  });

  it("says only that a new version exists on the web, which knows no number", () => {
    expect(updateMarkFor(web("available"))).toEqual({
      marked: true,
      settingsLabel: "Settings — a new version is available"
    });
  });

  it("leaves the button plain when nothing is newer", () => {
    const plain = { marked: false, settingsLabel: "Settings" };

    expect(updateMarkFor(web("current"))).toEqual(plain);
    expect(updateMarkFor(desktop("failed"))).toEqual(plain);
    expect(updateMarkFor(desktop("current"))).toEqual(plain);
    expect(updateMarkFor(UNSUPPORTED_UPDATES)).toEqual(plain);
  });
});
