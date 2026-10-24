import { describe, expect, it } from "vitest";
import {
  describeOutcome,
  installCommands,
  type LaunchProbe,
  waitForWindow
} from "./desktopLaunchCheck";

/** A clock that only moves when the loop sleeps, so a deadline is reached without waiting for it. */
function fakeClock() {
  let time = 0;
  return {
    now: () => time,
    sleep: async (ms: number) => {
      time += ms;
    }
  };
}

function probe(script: { windowAt?: number; exitAt?: number; code?: number }, now: () => number): LaunchProbe {
  return {
    exited: () => (script.exitAt !== undefined && now() >= script.exitAt ? (script.code ?? 0) : null),
    windowShown: async () => script.windowAt !== undefined && now() >= script.windowAt
  };
}

describe("waiting for the launched app's window", () => {
  it("a window seen before the deadline passes", async () => {
    const clock = fakeClock();
    const outcome = await waitForWindow(probe({ windowAt: 3_000 }, clock.now), {
      timeoutMs: 60_000,
      intervalMs: 1_000,
      ...clock
    });
    expect(outcome).toEqual({ kind: "window", afterMs: 3_000 });
  });

  it("an app that exits first fails with its exit code", async () => {
    const clock = fakeClock();
    const outcome = await waitForWindow(probe({ exitAt: 2_000, code: 101, windowAt: 5_000 }, clock.now), {
      timeoutMs: 60_000,
      intervalMs: 1_000,
      ...clock
    });
    expect(outcome).toEqual({ kind: "exited", code: 101 });
  });

  it("no window by the deadline fails", async () => {
    const clock = fakeClock();
    const outcome = await waitForWindow(probe({}, clock.now), {
      timeoutMs: 10_000,
      intervalMs: 1_000,
      ...clock
    });
    expect(outcome).toEqual({ kind: "timeout", afterMs: 10_000 });
  });

  it("each outcome reads as a pass or a failure naming R55", () => {
    expect(describeOutcome({ kind: "window", afterMs: 3_000 })).toEqual({
      ok: true,
      message: "R55: the window opened 3 s after launch."
    });
    expect(describeOutcome({ kind: "exited", code: 101 })).toEqual({
      ok: false,
      message: "R55: the app exited with code 101 before any window opened."
    });
    expect(describeOutcome({ kind: "timeout", afterMs: 90_000 })).toEqual({
      ok: false,
      message: "R55: no window opened within 90 s of launch."
    });
  });
});

describe("installing the bundle a release would publish", () => {
  it("macOS mounts the disk image and copies the app out of it", () => {
    expect(installCommands("darwin", "/b/Atlantis HUD_0.31.2_universal.dmg", "/t", "Atlantis HUD")).toEqual([
      ["hdiutil", "attach", "-nobrowse", "-readonly", "-mountpoint", "/t/mount", "/b/Atlantis HUD_0.31.2_universal.dmg"],
      ["ditto", "/t/mount/Atlantis HUD.app", "/t/Atlantis HUD.app"],
      ["hdiutil", "detach", "/t/mount"]
    ]);
  });

  it("Windows runs the installer silently into a chosen directory", () => {
    expect(installCommands("win32", "C:\\b\\setup.exe", "C:\\t", "Atlantis HUD")).toEqual([["C:\\b\\setup.exe", "/S", "/D=C:\\t\\app"]]);
  });

  it("Linux makes the AppImage executable", () => {
    expect(installCommands("linux", "/b/a.AppImage", "/t", "Atlantis HUD")).toEqual([["chmod", "+x", "/b/a.AppImage"]]);
  });
});
