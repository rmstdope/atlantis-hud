import { expect, type Page, test } from "@playwright/test";

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

/**
 * Activates a header control from the keyboard, without a pointer.
 *
 * The sign-in dialog's backdrop is `fixed inset-0 z-30` and paints over the whole header, so a
 * click on anything up there lands on the backdrop and dismisses the dialog instead. The dialog
 * has no focus trap by decision, so a keyboard player reaches the header regardless - and that is
 * the situation the guard under test exists for. `focus()` then `keyboard.press` does no hit
 * testing, which is what makes it the honest way to drive this and not a bypass.
 */
async function activate(page: Page, testId: string) {
  await page.getByTestId(testId).focus();
  await page.keyboard.press("Enter");
}

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

test("switching game closes the sign-in dialog, and coming back does not reopen it", async ({
  page
}) => {
  await clearGames(page);

  await page.getByTestId("game-ruleset").selectOption("newage-arcanum");
  await createGame(page, "First Arcanum game");

  // A second game on the same world: only the open game changes, so this walk pins the
  // `openGameId` dependency of the guard on its own. A game on another ruleset would take
  // `newAgeWorld` to null, and the dialog is not rendered at all then - which would pass whether
  // the guard fired or not.
  await page.getByTestId("game-indicator").click();
  await page.getByTestId("new-game").click();
  await page.getByTestId("game-ruleset").selectOption("newage-arcanum");
  await createGame(page, "Second Arcanum game");

  await page.getByTestId("newage-control").click();
  await expect(page.getByTestId("newage-signin-panel")).toBeVisible();

  // From here on the header is under the dialog's backdrop, so every control is reached by
  // keyboard - see `activate`.
  await activate(page, "game-indicator");
  await expect(page.getByTestId("game-picker")).toBeVisible();
  await page.getByRole("button", { name: "First Arcanum game", exact: true }).focus();
  await page.keyboard.press("Enter");

  await expect(page.getByTestId("game-indicator")).toContainText("First Arcanum game");
  await expect(page.getByTestId("newage-signin-panel")).toHaveCount(0);

  // Back again: the phase must not have survived the trip.
  await page.getByTestId("game-indicator").click();
  await page.getByRole("button", { name: "Second Arcanum game", exact: true }).click();
  await expect(page.getByTestId("game-indicator")).toContainText("Second Arcanum game");
  await expect(page.getByTestId("newage-signin-panel")).toHaveCount(0);
  await expect(page.getByTestId("newage-control")).toHaveText("Sign in to Arcanum");

  // Nothing was ever sent: the walk never submits, and an abort must not produce a request either.
  const calls = (await page.evaluate(
    () => (window as unknown as { __ATLANTIS_NEWAGE_CALLS__: NewAgeCall[] }).__ATLANTIS_NEWAGE_CALLS__
  )) as NewAgeCall[];
  expect(calls).toEqual([]);
});

test("changing the ruleset closes a sign-in dialog headed for the old world", async ({ page }) => {
  await clearGames(page);

  await page.getByTestId("game-ruleset").selectOption("newage-arcanum");
  await createGame(page, "Arcanum then Trident");

  await page.getByTestId("newage-control").click();
  await expect(page.getByTestId("newage-signin-panel")).toContainText("Sign in to New Age: Arcanum");

  // Settings opens *under* the sign-in backdrop, so it too is driven by keyboard throughout.
  await activate(page, "settings-indicator");
  await expect(page.getByTestId("settings-panel")).toBeVisible();
  await activate(page, "settings-tab-game");

  const ruleset = page.getByTestId("settings-game-ruleset");
  await expect(ruleset).toHaveValue("newage-arcanum");
  await ruleset.focus();
  // The plan called for `ArrowDown` here, on the reasoning that a closed `<select>` moves its
  // selection that way. It does not in Chromium on macOS, where the arrow keys open the native
  // popup instead and the value never changes - the walk was seen failing on `toHaveValue` with
  // the guard intact. `selectOption` is used instead, with `force` because the sign-in backdrop
  // covers the header and its Settings dialog: the option is set on the `<select>` itself and
  // `change` fires from it, so unlike a forced *click* nothing lands on the backdrop and the
  // dialog is not dismissed by the act of changing the ruleset. That was proved by hand while
  // writing this walk: with the `selectOption` line removed the `toHaveValue` below fails, and
  // with the guard's `dismissSignIn()` commented out the `toHaveCount(0)` below fails while
  // `toHaveValue` still passes.
  //
  // `force` skips the whole actionability set and not only the hit test, so the enabled check is
  // asserted explicitly first - the select carries `disabled={busy}`.
  await expect(ruleset).toBeEnabled();
  await ruleset.selectOption("newage-trident", { force: true });

  await expect(ruleset).toHaveValue("newage-trident");
  await expect(page.getByTestId("newage-signin-panel")).toHaveCount(0);
  await expect(page.getByTestId("newage-control")).toHaveText("Sign in to Trident");
});
