import { readFileSync } from "node:fs";
import { join } from "node:path";
import { browser, $, expect } from "@wdio/globals";
import {
  clearGamesNative,
  createGameUi,
  fillOrders,
  importStatusText,
  loadReportUi,
  openGameDb,
  selectHex,
  selectUnit
} from "./helpers";

/**
 * The issue's three test vectors, driven through the real desktop application.
 *
 * Deliberately not another walk of the widgets — the Playwright suite already does that against
 * both shells. What only this suite can see is the transport and the storage underneath: every
 * interaction here crosses Tauri IPC into the release binary, and the import lands in a SQLite
 * file this test opens from the outside, which is exactly the side of the desktop path no
 * browser-hosted test has ever reached.
 */

const REPORT = readFileSync(
  join(__dirname, "..", "fixtures", "reports", "neworigins-3.0.0-g7-f95-t71.rep"),
  "utf8"
);

/** Inholm's own unit, the same one the smoke suite edits. */
const OWN_UNIT = "18642";

describe("native desktop workspace", () => {
  before(async () => {
    await clearGamesNative();
  });

  it("imports the turn 71 report and persists it to the sidecar database", async () => {
    await $('[data-testid="game-gate"]').waitForDisplayed();
    await createGameUi("Native game");
    await loadReportUi(REPORT);

    // Through textContent, not Get Element Text: the routine status is sr-only and
    // WebKitWebDriver reports hidden text as empty.
    expect(await importStatusText()).toContain("11 regions");
    await expect($('[data-testid="app-header"]')).toHaveText(
      expect.stringContaining("Borg TNG (95)")
    );
    await expect($('[data-testid="app-header"]')).toHaveText(expect.stringContaining("71"));

    // The half the browser suites cannot see: the turn is a row in a file on disk, not an
    // IndexedDB entry, and it is readable from outside the application. Polled, because the
    // shell holds the writing connection and a reader can land inside its transaction.
    await browser.waitUntil(
      () => {
        const db = openGameDb();
        try {
          const rows = db
            .prepare("SELECT faction_id, turn_number FROM imported_turns ORDER BY turn_number")
            .all();
          return (
            rows.length === 1 && rows[0].faction_id === "95" && rows[0].turn_number === 71
          );
        } finally {
          db.close();
        }
      },
      { timeoutMsg: "imported_turns never held exactly the row (95, 71)" }
    );
  });

  it("selecting hex 1:7,53 lists its ninety-two units", async () => {
    await selectHex("1:7,53");
    await expect($('[data-testid="panel-units"]')).toHaveText(
      expect.stringContaining("92 units")
    );
  });

  it("edits orders and persists the draft to the sidecar database", async () => {
    await selectUnit(OWN_UNIT);
    await fillOrders("@work");
    await expect($('[data-testid="orders-status"]')).toHaveText(
      expect.stringContaining("0 errors")
    );

    // This used to click through to Export and capture the file at the `URL.createObjectURL`
    // boundary the way orders used to leave the app. Since ah-7pa, orders export goes through the
    // native save dialog - an OS window WebDriver cannot see, and cannot drive: Tauri defines
    // `__TAURI_INTERNALS__.invoke` with `Object.defineProperty` and no `writable`/`configurable`,
    // specifically so a page script cannot intercept or replace it, which is exactly what a
    // WebDriver-injected stub is. Clicking the real button here would open a real, un-dismissable
    // GTK dialog in CI with nothing to answer it.
    //
    // The content that used to be asserted here - the `#atlantis` header, the edited order text -
    // is still covered: `deliverOrdersExport`'s own unit tests
    // (`packages/shared/src/workspace/AppShell.test.ts`) prove it is built and handed to the
    // saver/download fork correctly, and the Playwright smoke suite exercises the same
    // `ordersExportText` output end-to-end against the web build's anchor download, which this
    // change left untouched. What only this native suite can still see is the sidecar-database
    // side of an edit, which does not depend on export at all - the workspace autosaves.

    // Polled, because the shell is free to flush drafts asynchronously; read-only, because the
    // shell holds the writing connection.
    await browser.waitUntil(
      () => {
        const db = openGameDb();
        try {
          const row = db
            .prepare("SELECT order_text FROM order_drafts WHERE faction_id = ?")
            .get("95") as { order_text?: string } | undefined;
          return Boolean(row?.order_text?.includes("@work"));
        } finally {
          db.close();
        }
      },
      { timeoutMsg: "no order draft containing @work ever reached order_drafts" }
    );
  });
});
