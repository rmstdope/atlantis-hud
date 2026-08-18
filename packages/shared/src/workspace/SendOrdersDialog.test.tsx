import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SendOrdersDialog } from "./SendOrdersDialog";
import type { SendOrdersPhase } from "./sendOrdersView";
import { interpretOrdersUploadReply } from "./ordersUpload";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const draw = (phase: SendOrdersPhase) =>
  renderToStaticMarkup(
    <SendOrdersDialog
      factionLabel="Green Tide (4)"
      turnNumber={71}
      serverHost="atlantis-pbem.com"
      phase={phase}
      onSend={() => {}}
      onDismiss={() => {}}
    />
  );

describe("the send dialog", () => {
  it("names the faction, the turn and the server, and cannot send an empty password", () => {
    const markup = draw({ kind: "ready" });
    expect(markup).toContain("Green Tide (4) · turn 71 · atlantis-pbem.com");
    expect(markup).toContain("Send orders to the server");
    expect(markup).toContain("Faction password");
    expect(markup).toContain('placeholder="Required"');
    const confirm = markup.match(/<button[^>]*data-testid="send-orders-confirm"[^>]*>/)![0];
    expect(confirm).toContain("disabled");
  });

  it("reports an acceptance, a refusal and an unreachable server, each in its own words", () => {
    expect(draw({ kind: "sent", serverReport: null })).toContain(
      "Orders for turn 71 were accepted by the server."
    );
    expect(draw({ kind: "refused", reason: "Faction password is incorrect." })).toContain(
      "Faction password is incorrect."
    );
    expect(draw({ kind: "refused", reason: null })).toContain(
      "The server refused the orders. Check the faction password and try again."
    );
    expect(draw({ kind: "unreachable" })).toContain("Could not reach the server.");
    expect(draw({ kind: "sending" })).toContain("Sending orders…");
  });

  it("offers Close instead of Cancel and Send once there is an outcome", () => {
    const settled = draw({ kind: "sent", serverReport: null });
    expect(settled).toContain('data-testid="send-orders-close"');
    expect(settled).not.toContain('data-testid="send-orders-confirm"');
    expect(draw({ kind: "ready" })).toContain('data-testid="send-orders-cancel"');
  });

  it("shows the server's report only when it is not the clean one", () => {
    expect(draw({ kind: "sent", serverReport: "No errors found." })).not.toContain(
      'data-testid="send-orders-report"'
    );
    const noisy = draw({ kind: "sent", serverReport: "Unit 1234: unknown order." });
    expect(noisy).toContain('data-testid="send-orders-report"');
    expect(noisy).toContain("The server reported");
    expect(noisy).toContain("Unit 1234: unknown order.");
  });

  it("never renders anything the server echoed back from the orders themselves", () => {
    const body = readFileSync(
      fileURLToPath(new URL("./fixtures/upload-accepted.html", import.meta.url)),
      "utf8"
    );
    const outcome = interpretOrdersUploadReply({ status: 200, body });
    const phases: SendOrdersPhase[] = [
      { kind: "ready" },
      { kind: "sending" },
      { kind: "sent", serverReport: outcome.kind === "accepted" ? outcome.serverReport : null },
      { kind: "refused", reason: null },
      { kind: "unreachable" }
    ];
    for (const phase of phases) {
      const markup = draw(phase);
      expect(markup).not.toContain("#atlantis");
      expect(markup).not.toContain("REDACTED");
    }
  });
});
