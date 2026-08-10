import { readFileSync } from "node:fs";
import { join } from "node:path";
import { browser, $, expect } from "@wdio/globals";
import {
  clearGamesNative,
  createGameUi,
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
  join(__dirname, "..", "fixtures", "reports", "neworigins-3.0.0-f95-t71.rep"),
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

  it("exports edited orders with the #atlantis header intact", async () => {
    await selectUnit(OWN_UNIT);
    const ordersInput = $('[data-testid="orders-input"]');
    await ordersInput.waitForDisplayed();
    await ordersInput.setValue("@work");
    await expect($('[data-testid="orders-status"]')).toHaveText(
      expect.stringContaining("0 errors")
    );

    // The export hands a Blob to `URL.createObjectURL` on its way to the anchor download, and
    // the download itself is browser chrome WebKitGTK gives WebDriver no view of. Capturing the
    // Blob at the URL boundary exercises the whole export path the application owns.
    await browser.execute(() => {
      const scope = window as unknown as { __exportCaptures?: Blob[] };
      scope.__exportCaptures = [];
      const original = URL.createObjectURL.bind(URL);
      URL.createObjectURL = (source: Blob | MediaSource) => {
        if (source instanceof Blob) {
          scope.__exportCaptures?.push(source);
        }
        return original(source);
      };
    });

    await $("button=Export orders").click();

    const exported = await browser.executeAsync<string | null, []>((done) => {
      const scope = window as unknown as { __exportCaptures?: Blob[] };
      const blob = scope.__exportCaptures?.[0];
      if (!blob) {
        done(null);
        return;
      }
      blob.text().then(done);
    });

    if (exported === null) {
      throw new Error("the export never handed a Blob to URL.createObjectURL");
    }
    expect(exported.startsWith("#atlantis")).toBe(true);
    expect(exported).toContain("@work");

    // The edit also has to survive as a draft in the sidecar database. Polled, because the
    // shell is free to flush drafts asynchronously; read-only, because the shell holds the
    // writing connection.
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
