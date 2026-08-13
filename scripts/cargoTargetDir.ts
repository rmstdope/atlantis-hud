import { execFileSync } from "node:child_process";
import { dirname, resolve, sep } from "node:path";

/** Where the agents' worktrees live, relative to the repository root. */
export const AGENT_WORKSPACES = ".claude";

/** One separator, so a comparison is about the path rather than about the platform. */
export function normalize(path: string): string {
  return resolve(path).split(sep).join("/");
}

/**
 * The repository root, the same path whether asked from the checkout or from one of its worktrees.
 *
 * `--show-toplevel` answers the worktree itself when run from inside one - exactly the bug this
 * exists to fix - so this goes by `--git-common-dir` instead, which every worktree shares, and
 * steps up one directory from the `.git` it names.
 */
export function repositoryRoot(cwd: string): string {
  const gitCommonDir = execFileSync(
    "git",
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    { cwd, encoding: "utf8" }
  ).trim();

  return dirname(gitCommonDir);
}

/** The value of `build.target-dir`, or nothing when the config does not set one. */
export function targetDir(text: string): string | null {
  const match = text.match(/^\s*target-dir\s*=\s*"([^"]*)"/mu);

  return match ? match[1] : null;
}

/**
 * The worktrees `git worktree list --porcelain` reports that do not sit inside the repository.
 *
 * `root` must be absolute; both it and every path parsed from `porcelain` are normalized before
 * comparison, since git reports forward slashes on every platform, including Windows.
 */
export function strayWorktrees(porcelain: string, root: string): string[] {
  const paths = [...porcelain.matchAll(/^worktree (.+)$/gmu)].map((match) => normalize(match[1]));
  const normalizedRoot = normalize(root);
  // The trailing separator is the whole guard: without it a sibling named `.claude-old` starts
  // with `.claude` and would pass as though it were inside.
  const inside = `${normalizedRoot}/${AGENT_WORKSPACES}/`;

  return paths.filter((path) => path !== normalizedRoot && !path.startsWith(inside));
}
