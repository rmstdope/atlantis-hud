/**
 * Keeps `.github/workflows/atlantis-rules-refresh.yml` honest about the three invariants a tidy-up
 * could silently break: that the schedule still exists, that `workflow_dispatch` still lets the
 * navigator force a refresh, and that the permissions it grants itself have not widened. Reads the
 * workflow as text, the same way `scripts/ciDocsGate.ts` reads `ci.yml` — see that file's own
 * comment for why this repository asserts a workflow's invariants this way rather than by parsing
 * YAML.
 */

import { onTriggerBlock } from "./ciDocsGate";

/** The workflow this gate reads. */
export const REFRESH_WORKFLOW = ".github/workflows/atlantis-rules-refresh.yml";

/** Whether it is still scheduled at all. A refresh nobody triggers is not a refresh. */
export function hasSchedule(yaml: string): boolean {
  return /^\s*schedule:\s*$/mu.test(onTriggerBlock(yaml));
}

/** Whether the workflow can still be run by hand — the navigator's only way to force a refresh. */
export function hasWorkflowDispatch(yaml: string): boolean {
  return /^\s*workflow_dispatch:\s*$/mu.test(onTriggerBlock(yaml));
}

/**
 * The permissions the workflow grants, so a tidy-up cannot silently widen them.
 *
 * Reads the top-level `permissions:` block only — the two-space-indented `key: value` lines
 * directly beneath it, stopping at the first line that is not one of those. A trailing `# comment`
 * on a permission line is discarded; only the value token itself is kept.
 */
export function declaredPermissions(yaml: string): Record<string, string> {
  const lines = yaml.split("\n");
  const start = lines.findIndex((line) => /^permissions:\s*$/u.test(line));
  if (start === -1) {
    return {};
  }

  const permissions: Record<string, string> = {};
  for (let i = start + 1; i < lines.length; i++) {
    const match = lines[i].match(/^ {2}([a-zA-Z0-9_-]+):\s*(\S+)/u);
    if (!match) {
      break;
    }
    permissions[match[1]] = match[2];
  }

  return permissions;
}
