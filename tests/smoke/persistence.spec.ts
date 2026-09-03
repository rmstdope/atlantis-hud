import { expect, test, type Page } from "@playwright/test";
import { readReport } from "@atlantis/fixtures";
import {
  clearGames,
  createGame,
  expectOrders,
  expectOrdersNot,
  fillOrders,
  openOrders,
  ordersInput,
  selectHex,
  selectUnit
} from "./gameSetup";

/**
 * The acceptance vectors of issue #34, end to end, in both shells.
 *
 * Unsaved data for the open game is saved - regularly, on switching games, and on the way out - and
 * reloaded when the game is opened again. Two things were broken before this: nothing ever wrote an
 * order draft, and nothing ever read an imported turn back, so opening a game showed an empty
 * workspace over a database that held the turn.
 *
 * `page.reload()` is how a browser quits and reopens. It is the same idiom `games.spec.ts` uses to
 * prove which game reopens, and here it proves what is inside one.
 */
const REPORT = readReport("g7f95t71");

/** Inholm holds 92 units; this one is the player's, so its orders are editable. */
const OWN_UNIT = "18642";

/**
 * A write that really happened, with the clock to show for it.
 *
 * Deliberately not the bare word: "unsaved changes" contains "saved", so a substring match on it
 * passes the instant the player types and proves nothing at all. This one only matches the panel
 * once it is showing a time.
 */
const SAVED = /saved \d/u;

/**
 * Opens the turn-71 report and waits for the import to be genuinely finished.
 *
 * Waiting on the status banner alone is not enough the second time: it is already reading
 * "11 regions" from the first import, so the assertion passes before the new one has run and the
 * selection made afterwards is then wiped when it does. The button leaving its "Importing…" state is
 * the shell saying the work is over.
 */
async function openReport(page: Page) {
  const load = page.getByRole("button", { name: "Import", exact: true });
  await expect(load).toBeEnabled();

  await page.setInputFiles('input[type="file"]', {
    name: "turn-71.rep",
    mimeType: "text/plain",
    buffer: Buffer.from(REPORT, "utf8")
  });

  await expect(page.getByTestId("import-status")).toContainText("11 regions");
  await expect(load).toBeEnabled();
}


/** Filtered down first, because the table only builds the rows that are on screen. */

/** Puts the orders editor for the player's own unit on screen. */

test("a game reopens on the turn that was loaded in it", async ({ page }) => {
  await clearGames(page);
  await createGame(page, "Reopening game");
  await openReport(page);

  await page.reload();

  // The turn, the header and the map all come back without the player opening the file again.
  await expect(page.getByTestId("import-status")).toContainText("restored turn 71");
  await expect(page.getByTestId("app-header")).toContainText("Borg TNG");
  await expect(page.getByTestId("app-header")).toContainText("Turn 71");
  await selectHex(page, "1:7,53");
  await expect(page.getByTestId("panel-region")).toContainText("Inholm");
});

/**
 * Where the map is standing, as the map itself writes it.
 *
 * The transform on the world group and the `--map-scale` custom property are what `applyView`
 * pushes into the DOM on every view move, so reading them back is reading the viewport without
 * asking the application to expose it.
 */
async function mapView(page: Page): Promise<{ transform: string; scale: string }> {
  const transform = await page.getByTestId("map-world").getAttribute("transform");
  const scale = await page
    .getByTestId("map-canvas")
    .locator("svg")
    .evaluate((svg) => svg.style.getPropertyValue("--map-scale"));
  return { transform: transform ?? "", scale };
}

/** Zooms in and pans far enough that the selected hex is nowhere near the middle any more. */
async function moveTheMap(page: Page) {
  const zoomIn = page.getByRole("button", { name: "Zoom in", exact: true });
  await zoomIn.click();
  await zoomIn.click();
  await zoomIn.click();
  await zoomIn.click();

  const hex = page.getByRole("button", { name: "hex 1:7,53", exact: true });
  await hex.focus();
  for (let nudge = 0; nudge < 10; nudge += 1) {
    // Shift+Arrow pans without moving focus, so the selection stays put while the view leaves it.
    await hex.press("Shift+ArrowRight");
  }
}

test("a game reopens on the map view it was left at", async ({ page }) => {
  await clearGames(page);
  await createGame(page, "Viewport game");
  await openReport(page);
  await selectHex(page, "1:7,53");
  await moveTheMap(page);

  const left = await mapView(page);

  await page.reload();
  await expect(page.getByTestId("import-status")).toContainText("restored turn 71");

  // The hex the player was working on comes back selected, and the map does not travel to it: the
  // player had deliberately panned away, and pulling the view back is the reset this is about.
  await expect(page.getByRole("button", { name: "hex 1:7,53", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  await expect(page.getByTestId("map-world")).toHaveAttribute("transform", left.transform);
  expect((await mapView(page)).scale).toBe(left.scale);

  // Storage remembers a hex, never a unit - a unit id may not survive to the next turn. The hex's
  // first unit is filled in on arrival, so a restored selection does not come back over an empty
  // detail panel.
  await expect(page.getByTestId("panel-unit")).not.toContainText("No unit selected");
});

test("each game keeps its own map view", async ({ page }) => {
  await clearGames(page);
  await createGame(page, "First game");
  await openReport(page);
  await selectHex(page, "1:7,53");
  await moveTheMap(page);

  const first = await mapView(page);

  // A second game has a view of its own, and has never been anywhere: it opens framed on its own
  // map rather than on the corner of the map the other game was left in.
  await page.getByTestId("game-indicator").click();
  await page.getByTestId("new-game").click();
  await createGame(page, "Second game");
  await openReport(page);
  expect((await mapView(page)).transform).not.toBe(first.transform);

  await page.getByTestId("game-indicator").click();
  await page.getByRole("button", { name: "First game", exact: true }).click();

  await expect(page.getByTestId("import-status")).toContainText("restored turn 71");
  await expect(page.getByTestId("map-world")).toHaveAttribute("transform", first.transform);
});

test("a turn landing in the open game leaves the map where it is", async ({ page }) => {
  await clearGames(page);
  await createGame(page, "Re-framing game");
  await openReport(page);
  await selectHex(page, "1:7,53");
  await moveTheMap(page);

  const before = await mapView(page);

  await openReport(page);

  // A new turn changes what is drawn, not where the player is standing. Framing the whole level
  // again would throw away a position they had just chosen.
  await expect(page.getByTestId("map-world")).toHaveAttribute("transform", before.transform);
  expect((await mapView(page)).scale).toBe(before.scale);
});

test("a pane opening leaves the map where it is", async ({ page }) => {
  await clearGames(page);
  await createGame(page, "Pane reflow game");
  await openReport(page);
  await selectHex(page, "1:7,53");
  await moveTheMap(page);

  const before = await mapView(page);

  // Collapsing and reopening a pane reflows the strip the map fits against, exactly as a re-import
  // that changes the header's chip count does. Nothing about the selection changed, so the map must
  // not travel to it - ah-5g9, after ah-dbb.2 hit this 3/3 on CI and 0/3 locally.
  //
  // The units pane, not the region pane: it sits on the map's "bottom" edge and its collapsed
  // height actually moves that edge's measured reach (`overlayInsets`'s vertical "bottom" is the
  // host's bottom minus the pane's top). The region pane's collapse only changes its height inside
  // a fixed-width rail, which never moves the "left" edge's horizontal reach - so toggling it would
  // not exercise the insets path this test exists to cover.
  // The fold toggle by the attribute this test then asserts on, not "the button in the header":
  // the units pane's header also carries the Add to army trigger now (ah-1mpx.2), and a bare
  // `header button` matches both.
  const unitsPanelToggle = page.locator(
    '[data-testid="panel-units"] header button[aria-expanded]'
  );
  await unitsPanelToggle.click();
  await expect(unitsPanelToggle).toHaveAttribute("aria-expanded", "false");
  await unitsPanelToggle.click();
  await expect(unitsPanelToggle).toHaveAttribute("aria-expanded", "true");

  await expect(page.getByTestId("map-world")).toHaveAttribute("transform", before.transform);
  expect((await mapView(page)).scale).toBe(before.scale);
});

test("orders typed into a game are still there after a reload", async ({ page }) => {
  await clearGames(page);
  await createGame(page, "Typing game");
  await openReport(page);
  await openOrders(page, OWN_UNIT);

  await fillOrders(page, "@work\n@study combat");

  // The panel says what has actually happened, rather than stamping the clock as it used to.
  await expect(page.getByTestId("orders-status")).toContainText("unsaved changes");
  await expect(page.getByTestId("orders-status")).toContainText(SAVED, { timeout: 20_000 });

  await page.reload();
  await expect(page.getByTestId("import-status")).toContainText("restored turn 71");
  await openOrders(page, OWN_UNIT);

  await expectOrders(page, /@study combat/u);
  // And it comes back knowing it is saved, rather than claiming never to have been.
  await expect(page.getByTestId("orders-status")).toContainText(SAVED);
});

test("a saved draft gains its missing trailing newline without moving the cursor", async ({
  page
}) => {
  await clearGames(page);
  await createGame(page, "Newline game");
  await openReport(page);
  await openOrders(page, OWN_UNIT);

  const editor = ordersInput(page);
  await fillOrders(page, "@work\n@study combat");
  // Park the caret mid-word, where an append at the end must not disturb it - and where a
  // whole-value replacement (the old editor's answer to an external change) visibly would.
  // Select-all, collapse to the start, then walk three steps: the same caret on every platform.
  await editor.click();
  await editor.press("ControlOrMeta+a");
  await editor.press("ArrowLeft");
  await editor.press("ArrowRight");
  await editor.press("ArrowRight");
  await editor.press("ArrowRight");

  // Untouched until the save lands: tidying on the keystroke would be the racy behaviour the
  // save gate exists to rule out, and would pass the assertions below by accident.
  await expectOrders(page, /@study combat$/u);

  await expect(page.getByTestId("orders-status")).toContainText(SAVED, { timeout: 20_000 });

  await expectOrders(page, /@study combat\n$/u);
  // The caret sits where it was parked: three characters into "@work", still collapsed. Measured
  // from the start of the line rather than of one text node, because a finding on this line makes
  // the editor highlight part of it and so splits the line into several nodes.
  const caret = await editor.evaluate((root: Element) => {
    const selection = window.getSelection();
    const anchor = selection?.anchorNode ?? null;
    if (!anchor || !selection) {
      return { offset: -1, collapsed: false, line: "" };
    }
    let line: Element | null =
      anchor.nodeType === Node.ELEMENT_NODE ? (anchor as Element) : anchor.parentElement;
    while (line?.parentElement && line.parentElement !== root) {
      line = line.parentElement;
    }
    const range = document.createRange();
    range.selectNodeContents(line ?? root);
    range.setEnd(anchor, selection.anchorOffset);
    return {
      offset: range.toString().length,
      collapsed: selection.isCollapsed,
      line: line?.textContent ?? ""
    };
  });
  expect(caret).toEqual({ offset: 3, collapsed: true, line: "@work" });
});

/**
 * The late restore must not clobber what the player has since typed.
 *
 * Opening a game starts a restore that waits for the ruleset fetch; importing a report and
 * typing does not wait for either. On a slow connection the restore therefore resolves *after*
 * the player is already working, and re-applying the stored snapshot then wiped their typing -
 * caught as a CI-only flake, because only CI machines were slow enough. The route delay below
 * makes that ordering deterministic instead of machine-dependent.
 */
test("a slow ruleset fetch cannot wipe orders typed after an import", async ({ page }) => {
  await page.route("**/ruleset.json", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    await route.continue();
  });

  await clearGames(page);
  await createGame(page, "Slow ruleset game");
  await openReport(page);
  await openOrders(page, OWN_UNIT);
  await fillOrders(page, "@work");
  await expectOrders(page, /^@work\n?$/u);

  // Both the restore and the import wait on the same fetch, and since ah-6yj2 the import waits
  // too - so the counts, not "restored turn 71", are what the header settles on. Either way the
  // fetch has landed and the restore has had its chance to clobber, which is what this walk is
  // about: the words the player typed still stand.
  await expect(page.getByTestId("import-status")).toContainText("11 regions", {
    timeout: 20_000
  });
  await expectOrders(page, /^@work\n?$/u);
  // A moment past the fetch, in case the restore resolves a tick behind the import.
  await page.waitForTimeout(500);
  await expectOrders(page, /^@work\n?$/u);
});

test("switching to another game and back loses neither the turn nor the orders", async ({
  page
}) => {
  await clearGames(page);
  await createGame(page, "First game");
  await openReport(page);
  await openOrders(page, OWN_UNIT);
  await fillOrders(page, "@work\n@teach 18642");

  // Straight to another game, without waiting for the autosave: switching is one of the three
  // moments issue #34 names, and it has to write on its own.
  await page.getByTestId("game-indicator").click();
  await page.getByTestId("new-game").click();
  await createGame(page, "Second game");

  // The new game is empty - one game's turn must never show under another's name.
  await expect(page.getByTestId("import-status")).toContainText("no report loaded");

  await page.getByTestId("game-indicator").click();
  await page.getByRole("button", { name: "First game", exact: true }).click();

  await expect(page.getByTestId("import-status")).toContainText("restored turn 71");
  await openOrders(page, OWN_UNIT);
  await expectOrders(page, /@teach 18642/u);
});

test("one game's orders never appear in another", async ({ page }) => {
  await clearGames(page);
  await createGame(page, "Alpha game");
  await openReport(page);
  await openOrders(page, OWN_UNIT);
  await fillOrders(page, "@work\n@build");
  await expect(page.getByTestId("orders-status")).toContainText(SAVED, { timeout: 20_000 });

  await page.getByTestId("game-indicator").click();
  await page.getByTestId("new-game").click();
  await createGame(page, "Beta game");
  await openReport(page);
  await openOrders(page, OWN_UNIT);

  // The same faction and the same turn, in a different game: its own database, its own template.
  await expectOrdersNot(page, /@build/u);
});

test("a game with no imports opens on an empty workspace rather than an error", async ({ page }) => {
  await clearGames(page);
  await createGame(page, "Fresh game");

  // Nothing to restore is the ordinary state of a game just created, and must not read as failure.
  await expect(page.getByTestId("import-status")).toContainText("no report loaded");
  await expect(page.getByTestId("import-status")).not.toContainText("could not");

  await page.reload();

  await expect(page.getByTestId("game-indicator")).toContainText("Fresh game");
  await expect(page.getByTestId("import-status")).toContainText("no report loaded");
});

/**
 * A game made before merged reports existed still opens.
 *
 * Issue #53 bumped the per-game IndexedDB version from 1 to 2 to add a store. Version 1 created its
 * three stores unconditionally in `onupgradeneeded`, which was harmless while there was only ever
 * one version and a `ConstraintError` on every existing database the moment a second one appeared -
 * so every game a player already had would have become unopenable.
 *
 * The only way to test that is to put a version-1 database back, which is what this does. Nothing
 * else in either suite would notice: a fresh game creates the current schema in one step and never
 * takes the upgrade path at all.
 */
test("a game created before the merge store still opens", async ({ page }) => {
  await clearGames(page);

  // Written from scratch rather than by downgrading a live one: the workspace holds its game
  // database open, so deleting it from here would block for ever. With no game open there is
  // nothing to block, and a database the application has never seen is exactly what a game from
  // the previous release is.
  await page.evaluate(async () => {
    const stamp = "2026-08-01T09:00:00Z";
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("atlantis-hud-game-legacy", 1);
      request.onupgradeneeded = () => {
        const database = request.result;
        database.createObjectStore("importedTurns", { keyPath: ["factionId", "turnNumber"] });
        database.createObjectStore("orderDrafts", { keyPath: ["factionId", "turnNumber"] });
        database.createObjectStore("regionSightings", { keyPath: ["factionId", "regionId"] });
      };
      request.onsuccess = () => {
        request.result.close();
        resolve();
      };
      request.onerror = () => reject(request.error);
    });

    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("atlantis-hud", 4);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains("games")) {
          database.createObjectStore("games", { keyPath: "gameId" });
        }
      };
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction("games", "readwrite");
        transaction.objectStore("games").put({
          gameId: "legacy",
          databasePath: "idb://game-legacy",
          schemaVersion: 1,
          manifest: {
            manifestVersion: 1,
            metadata: { gameId: "legacy", gameName: "Legacy game", rulesetId: "neworigins" },
            reportSources: [],
            createdAt: stamp,
            lastOpenedAt: stamp
          }
        });
        transaction.oncomplete = () => {
          database.close();
          resolve();
        };
        transaction.onerror = () => reject(transaction.error);
      };
      request.onerror = () => reject(request.error);
    });
  });

  await page.reload();

  // Opening it runs the upgrade, which has to add the one missing store and leave the three that
  // are already there alone. Creating them unconditionally would throw here, and the workspace
  // would never appear.
  await expect(page.getByTestId("game-indicator")).toContainText("Legacy game");
  await expect(page.getByTestId("import-status")).not.toContainText("could not");
  await openReport(page);
  await expect(page.getByTestId("import-status")).toContainText("11 regions");
});

test("re-opening the same report keeps the orders already written for that turn", async ({
  page
}) => {
  await clearGames(page);
  await createGame(page, "Re-import game");
  await openReport(page);
  await openOrders(page, OWN_UNIT);
  await fillOrders(page, "@work\n@entertain");
  await expect(page.getByTestId("orders-status")).toContainText(SAVED, { timeout: 20_000 });

  // There is no undo anywhere in this application, so a stray file-open must not erase an evening.
  await openReport(page);
  await openOrders(page, OWN_UNIT);

  await expectOrders(page, /@entertain/u);
});
