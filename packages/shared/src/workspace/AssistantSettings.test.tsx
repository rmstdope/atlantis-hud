import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { claudeAddCommand } from "../assistant/assistantTransport";
import { AssistantSettingsView } from "./AssistantSettings";

const CONNECTION = { url: "http://127.0.0.1:47615/mcp", token: "abc123", error: null };

describe("connecting Claude Code", () => {
  it("is one command, for every directory, carrying the HUD's token", () => {
    expect(claudeAddCommand(CONNECTION)).toBe(
      'claude mcp add --scope user --transport http atlantis-hud http://127.0.0.1:47615/mcp --header "Authorization: Bearer abc123"'
    );
  });

  it("shows the command with a way to copy it", () => {
    const html = renderToStaticMarkup(<AssistantSettingsView connection={CONNECTION} failed={null} />);

    expect(html).toContain('data-testid="assistant-settings-command"');
    expect(html).toContain("Bearer abc123");
    expect(html).toContain('data-testid="assistant-settings-copy"');
  });

  it("says why the assistant cannot connect, and offers no command", () => {
    const html = renderToStaticMarkup(
      <AssistantSettingsView connection={{ ...CONNECTION, error: "port 47615: address in use" }} failed={null} />
    );

    expect(html).toContain("cannot connect: port 47615: address in use");
    expect(html).not.toContain("assistant-settings-command");
  });
});
