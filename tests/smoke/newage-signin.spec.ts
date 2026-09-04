import { expect, test } from "@playwright/test";

import { clearGames, createGame } from "./gameSetup";

/**
 * Signing in to a New Age world, end to end (ah-lbd9.2).
 *
 * The only place this bead's whole path runs: the header control, the dialog, a refusal, an
 * acceptance, the popover and signing out again. `packages/shared` has no jsdom by decision
 * (ah-nass), so the clear-and-refocus after a refusal and the focus return on Escape are unreachable
 * by a unit test there - they are promised here.
 *
 * `desktop-shell` only, because the transport is the desktop one: the stand-in is installed by
 * `page.addInitScript`, before the bundle's own scripts run, since `desktopNewAgeTransport()`
 * evaluates `desktopPlugins()` once at the call in `App.tsx`.
 *
 * **The recorded calls carry a body's length and never its content.** A New Age reply can carry a
 * password in cleartext, and the rule `desktop-shell.spec.ts` already keeps holds here too.
 */
const LOGIN_URL = "https://atlantis-newage.com/api/worlds/arcanum/auth/login";

type NewAgeCall = ["httpRequest", string, string, number];

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-shell",
    "the New Age transport is only there in the desktop bundle"
  );

  await page.addInitScript(() => {
    const calls: unknown[][] = [];
    (window as unknown as { __ATLANTIS_NEWAGE_CALLS__: unknown[][] }).__ATLANTIS_NEWAGE_CALLS__ =
      calls;
    // A queue the walk consumes in order: the wrong password first, the right one second. Anything
    // beyond it is a call this spec did not expect, and a 500 makes that loud.
    const replies: Array<{ status: number; body: string }> = [
      { status: 401, body: JSON.stringify({ detail: "Invalid faction ID or password" }) },
      {
        status: 200,
        body: JSON.stringify({
          access_token: "a-token",
          faction: { id: 27, name: "Merchant Guild", status: "active" }
        })
      }
    ];
    (
      window as unknown as {
        __ATLANTIS_DESKTOP_PLUGINS__: {
          httpRequest(
            request: {
              method: string;
              url: string;
              headers: Record<string, string>;
              body?: string;
            },
            signal: AbortSignal
          ): Promise<{ status: number; body: string }>;
        };
      }
    ).__ATLANTIS_DESKTOP_PLUGINS__ = {
      async httpRequest(
        request: { method: string; url: string; headers: Record<string, string>; body?: string },
        _signal: AbortSignal
      ) {
        calls.push(["httpRequest", request.method, request.url, request.body?.length ?? 0]);
        return replies.shift() ?? { status: 500, body: "{}" };
      }
    };
  });
});

test("a player signs in to a New Age world, is refused once, and signs out again", async ({
  page
}) => {
  await clearGames(page);

  await page.getByTestId("game-ruleset").selectOption("newage-arcanum");
  await createGame(page, "Arcanum game");

  const control = page.getByTestId("newage-control");
  await expect(control).toHaveText("Sign in to Arcanum");

  await control.click();
  await expect(page.getByTestId("newage-signin-panel")).toContainText("Sign in to New Age: Arcanum");

  await page.getByTestId("newage-faction-number").fill("27");
  await page.getByTestId("newage-password").fill("wrong");
  await page.getByTestId("newage-signin-confirm").click();

  await expect(page.getByTestId("newage-signin-message")).toHaveText(
    "The world did not accept that faction number and password."
  );
  // Cleared and ready to be retyped; the faction number is left as it was.
  await expect(page.getByTestId("newage-password")).toHaveValue("");
  await expect(page.getByTestId("newage-faction-number")).toHaveValue("27");

  await page.getByTestId("newage-password").fill("right");
  await page.getByTestId("newage-signin-confirm").click();

  await expect(page.getByTestId("newage-signin-panel")).toHaveCount(0);
  await expect(control).toHaveText(/Merchant Guild/);

  const calls = (await page.evaluate(
    () => (window as unknown as { __ATLANTIS_NEWAGE_CALLS__: NewAgeCall[] }).__ATLANTIS_NEWAGE_CALLS__
  )) as NewAgeCall[];
  expect(calls).toHaveLength(2);
  for (const call of calls) {
    expect(call[1]).toBe("POST");
    expect(call[2]).toBe(LOGIN_URL);
    expect(call[3]).toBeGreaterThan(0);
  }

  await control.click();
  await expect(page.getByTestId("newage-panel")).toContainText(
    "Signed in to New Age: Arcanum as Merchant Guild (27)."
  );
  await page.getByTestId("newage-signout").click();
  await expect(control).toHaveText("Sign in to Arcanum");

  // Escape closes the dialog and gives focus back to the control that opened it - the promise no
  // unit test in `packages/shared` can make.
  await control.click();
  await expect(page.getByTestId("newage-signin-panel")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("newage-signin-panel")).toHaveCount(0);
  await expect(control).toBeFocused();
});
