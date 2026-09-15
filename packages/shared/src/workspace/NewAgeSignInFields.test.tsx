import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { NewAgeSignInFields } from "./NewAgeSignInFields";

const draw = (password: string) =>
  renderToStaticMarkup(
    <NewAgeSignInFields
      factionNumber="27"
      password={password}
      note="Used for this fetch only."
      phase={{ kind: "ready" }}
      onFactionNumber={() => {}}
      onPassword={() => {}}
    />
  );

const passwordField = (markup: string) => {
  const match = markup.match(/<input[^>]*data-testid="newage-password"[^>]*>/);
  if (match === null) {
    throw new Error("no password field drawn");
  }
  return match[0];
};

describe("NewAgeSignInFields", () => {
  it("outlines an empty password field in red", () => {
    expect(passwordField(draw(""))).toContain("border-danger");
    expect(passwordField(draw(""))).not.toContain("border-edge");
  });

  it("drops the red outline as soon as one character is typed", () => {
    expect(passwordField(draw("x"))).toContain("border-edge");
    expect(passwordField(draw("x"))).not.toContain("border-danger");
  });
});
