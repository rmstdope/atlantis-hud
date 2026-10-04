import type { MagicTree } from "./magicTree";

/**
 * Walking the magic study tree's Branches view with the keyboard (ah-0unf,
 * `docs/ui/ah-0unf-keyboard.html`): which skill the mark moves to for a key.
 *
 * Kept pure and apart from the dialog so the rule can be tested in this package, which has no
 * jsdom (ah-nass): the dialog only moves focus and scrolls, and the smoke suite watches that.
 */

/** Every skill in on-screen order - branch by branch, row by row - with its branch's index. */
export function magicTreeOrder(tree: MagicTree): readonly { tag: string; branch: number }[] {
  return tree.branches.flatMap((branch, index) =>
    branch.skills.map((skill) => ({ tag: skill.tag, branch: index }))
  );
}

/**
 * The tag the mark moves to for `key`, or null for a key the tree leaves alone.
 *
 * The mark stops at either end rather than wrapping, and a key that cannot move it returns
 * `current` rather than null: the key is still the tree's, so the caller still keeps it from
 * scrolling the list. Nothing marked (or a tag the tree does not hold) sits before the first skill
 * for the keys that go down and after the last for the keys that go up.
 */
export function nextMagicTreeMark(tree: MagicTree, current: string | null, key: string): string | null {
  const order = magicTreeOrder(tree);
  if (order.length === 0) {
    return null;
  }
  const last = order.length - 1;
  const at = current === null ? -1 : order.findIndex((entry) => entry.tag === current);
  const marked = at >= 0;
  const firstOfBranch = (branch: number) => order.findIndex((entry) => entry.branch === branch);

  switch (key) {
    case "ArrowDown":
      return order[marked ? Math.min(at + 1, last) : 0].tag;
    case "ArrowUp":
      return order[marked ? Math.max(at - 1, 0) : last].tag;
    case "Home":
      return order[0].tag;
    case "End":
      return order[last].tag;
    case "PageDown": {
      if (!marked) {
        return order[0].tag;
      }
      const next = firstOfBranch(order[at].branch + 1);
      return order[next < 0 ? at : next].tag;
    }
    case "PageUp": {
      if (!marked) {
        return order[firstOfBranch(order[last].branch)].tag;
      }
      const top = firstOfBranch(order[at].branch);
      if (top < at) {
        return order[top].tag;
      }
      return order[order[at].branch === 0 ? at : firstOfBranch(order[at].branch - 1)].tag;
    }
    default:
      return null;
  }
}
