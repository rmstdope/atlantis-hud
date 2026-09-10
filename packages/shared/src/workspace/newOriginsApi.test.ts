import { describe, expect, it, vi } from "vitest";

import {
  DOWNLOAD_REPORT_URL,
  downloadNewOriginsReport,
  downloadReportRequest,
  interpretDownloadReply
} from "./newOriginsApi";

const REFUSAL_PAGE = `<html><body>
  <div class="alert alert-danger text-center">
    <h3>Faction password is incorrect. Try again or contact the Game Masters on Discord to change your password.</h3>
  </div>
</body></html>`;

describe("downloadReportRequest", () => {
  it("posts the faction number and password as the site's own form does", () => {
    const request = downloadReportRequest("27", "hunter2");
    expect(request.url).toBe("https://atlantis-pbem.com/game/download-report");
    expect(DOWNLOAD_REPORT_URL).toBe(request.url);
    expect(request.contentType).toBe("application/x-www-form-urlencoded");
    const fields = new URLSearchParams(request.body);
    expect(fields.get("factionId")).toBe("27");
    expect(fields.get("password")).toBe("hunter2");
    expect([...fields.keys()].sort()).toEqual(["factionId", "password"]);
  });

  it("carries a password with urlencoding's own characters through unchanged", () => {
    const password = 'a&b=c+d e"f';
    const fields = new URLSearchParams(downloadReportRequest("27", password).body);
    expect(fields.get("password")).toBe(password);
  });

  it("refuses a faction number that is not digits", () => {
    expect(() => downloadReportRequest("foo", "hunter2")).toThrow();
    expect(() => downloadReportRequest("", "hunter2")).toThrow();
  });
});

describe("interpretDownloadReply", () => {
  it("reads a refusal out of the site's own red block", () => {
    expect(interpretDownloadReply({ status: 200, body: REFUSAL_PAGE })).toEqual({
      kind: "refused",
      reason:
        "Faction password is incorrect. Try again or contact the Game Masters on Discord to change your password."
    });
  });

  it("takes a page with no red block as the report", () => {
    const body = "Atlantis Report For:\nMerchant Guild (27)\n";
    expect(interpretDownloadReply({ status: 200, body })).toEqual({ kind: "ok", text: body });
  });

  it("refuses a 500 even when it carries no red block", () => {
    expect(interpretDownloadReply({ status: 500, body: "oops" })).toEqual({
      kind: "refused",
      reason: null
    });
  });
});

describe("downloadNewOriginsReport", () => {
  it("says unreachable without looking at what the transport threw", async () => {
    const result = await downloadNewOriginsReport(
      () => Promise.reject(new Error("POST failed: factionId=27&password=hunter2")),
      "27",
      "hunter2",
      new AbortController().signal
    );
    expect(result).toEqual({ kind: "unreachable" });
    expect(JSON.stringify(result)).not.toContain("hunter2");
  });

  it("refuses a faction number the site could not file under, rather than throwing", async () => {
    const transport = vi.fn();
    const result = await downloadNewOriginsReport(
      transport,
      "foo",
      "hunter2",
      new AbortController().signal
    );
    // The dialog gates this, so it is defence in depth - but a throw here escapes the run, whose
    // caller does not await it, and would leave the dialog fetching for ever.
    expect(result).toEqual({ kind: "refused", reason: null });
    expect(transport).not.toHaveBeenCalled();
  });

  it("posts the form and reads what came back", async () => {
    const seen: unknown[] = [];
    const result = await downloadNewOriginsReport(
      (request) => {
        seen.push(request);
        return Promise.resolve({ status: 200, body: "Atlantis Report For:" });
      },
      "27",
      "hunter2",
      new AbortController().signal
    );
    expect(result).toEqual({ kind: "ok", text: "Atlantis Report For:" });
    expect(seen).toEqual([
      {
        method: "POST",
        url: DOWNLOAD_REPORT_URL,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "factionId=27&password=hunter2"
      }
    ]);
  });
});
