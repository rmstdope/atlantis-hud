import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  ASSISTANT_ALL_CLEAR_LINE,
  ASSISTANT_ASKS_LINE,
  ASSISTANT_STOPPED_LINE,
  sendReminders,
  type AssistantPrompt
} from "../assistant/assistantSend";
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
    expect(confirm).toContain('title="Password must be entered"');
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

  it("keeps the field, so a refused password can simply be retyped", () => {
    const refused = draw({ kind: "refused", reason: "Faction password is incorrect." });
    expect(refused).toContain('data-testid="send-orders-password"');
    expect(refused).toContain('data-testid="send-orders-confirm"');
    expect(refused).not.toContain('data-testid="send-orders-close"');
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

const drawAsked = (phase: SendOrdersPhase, assistant: AssistantPrompt | undefined) =>
  renderToStaticMarkup(
    <SendOrdersDialog
      factionLabel="Green Tide (4)"
      turnNumber={71}
      serverHost="atlantis-pbem.com"
      phase={phase}
      assistant={assistant}
      onSend={() => {}}
      onDismiss={() => {}}
    />
  );
const buttonOf = (markup: string, testId: string) =>
  markup.match(new RegExp(`<button[^>]*data-testid="${testId}"[^>]*>`))?.[0] ?? "";

describe("when the assistant asks (ah-9vmbx.2)", () => {
  const asking = (reminders = sendReminders(4, 2)): AssistantPrompt => ({ kind: "asking", reminders });

  it("adds the assistant's line under the meta line, marked by a brass edge", () => {
    const markup = drawAsked({ kind: "ready" }, asking());
    expect(markup).toContain(ASSISTANT_ASKS_LINE);
    const line = markup.match(/<p[^>]*data-testid="assistant-send-line"[^>]*>/)![0];
    expect(line).toContain("border-l-2");
    expect(line).toContain("border-brass");
    expect(markup.indexOf("Green Tide (4) · turn 71 · atlantis-pbem.com")).toBeLessThan(markup.indexOf(ASSISTANT_ASKS_LINE));
  });

  it("shows the reminders in amber, above the password field", () => {
    const markup = drawAsked({ kind: "ready" }, asking());
    expect(markup).toContain("4 changes by the assistant you have not kept or reverted yet");
    expect(markup).toContain("2 problems found in these orders");
    expect(markup).toContain("text-warn");
    expect(markup.indexOf("2 problems found")).toBeLessThan(markup.indexOf("Faction password"));
  });

  it("shows the soft all-clear when nothing is outstanding", () => {
    const markup = drawAsked({ kind: "ready" }, asking(sendReminders(0, 0)));
    expect(markup).toContain(ASSISTANT_ALL_CLEAR_LINE);
    expect(markup).not.toContain("text-warn");
  });

  it("turns Cancel off while the orders are on their way", () => {
    expect(buttonOf(drawAsked({ kind: "sending" }, asking()), "send-orders-cancel")).toMatch(/ disabled=""/);
    expect(buttonOf(drawAsked({ kind: "ready" }, asking()), "send-orders-cancel")).not.toMatch(/ disabled=""/);
  });

  it("keeps the assistant's line over a result, and drops the reminders", () => {
    const markup = drawAsked({ kind: "sent", serverReport: null }, asking());
    expect(markup).toContain(ASSISTANT_ASKS_LINE);
    expect(markup).not.toContain("2 problems found in these orders");
    expect(markup).toContain(`data-testid="${"send-orders-close"}"`);
  });

  it("once the assistant stopped waiting, says so with a single Close and nothing to type", () => {
    const markup = drawAsked({ kind: "ready" }, { kind: "stopped" });
    expect(markup).toContain(ASSISTANT_STOPPED_LINE);
    expect(markup).toContain("Green Tide (4) · turn 71 · atlantis-pbem.com");
    expect(markup).toContain(`data-testid="${"send-orders-close"}"`);
    expect(markup).not.toContain('type="password"');
    expect(markup).not.toContain(`data-testid="${"send-orders-cancel"}"`);
    expect(markup).not.toContain(ASSISTANT_ASKS_LINE);
    expect(markup).not.toContain("problems found");
  });

  it("is today's dialog exactly when the assistant did not ask", () => {
    const markup = drawAsked({ kind: "ready" }, undefined);
    expect(markup).not.toContain("assistant-send-");
    expect(markup).not.toContain(ASSISTANT_STOPPED_LINE);
  });
});
