import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * Every rule id the repository's real flat config reports for `code`, linted as if it were a
 * `.tsx` file inside `packages/shared/src` — the package the retrospective's defect was in, and
 * the one whose harness (no jsdom, ah-nass) cannot catch this class any other way.
 */
async function ruleIdsFor(code: string): Promise<string[]> {
  const eslint = new ESLint({ overrideConfigFile: join(REPO, "eslint.config.mjs") });
  const [result] = await eslint.lintText(code, {
    filePath: join(REPO, "packages", "shared", "src", "hooksGateProbe.tsx")
  });
  return result.messages.map((message) => message.ruleId ?? "");
}

describe("the repository's ESLint config", () => {
  it("reports react-hooks/rules-of-hooks for a hook called after an early return", async () => {
    const ruleIds = await ruleIdsFor(`import { useState } from "react";

export function Conditional({ ready }: { ready: boolean }) {
  if (!ready) return null;
  const [count] = useState(0);
  return <span>{count}</span>;
}
`);
    expect(ruleIds).toContain("react-hooks/rules-of-hooks");
  });

  it("reports nothing for a component whose hooks are unconditional", async () => {
    const ruleIds = await ruleIdsFor(`import { useState } from "react";

export function Unconditional({ ready }: { ready: boolean }) {
  const [count] = useState(0);
  return <span>{ready ? count : null}</span>;
}
`);
    expect(ruleIds).toEqual([]);
  });
});
