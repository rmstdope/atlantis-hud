import { snippetCompletion, type Completion, type CompletionSource } from "@codemirror/autocomplete";
import type { CaretLookup } from "./orderCompletion";

/**
 * A reusable block of orders, insertable by name from the editor's completion popup.
 *
 * The body may carry CodeMirror snippet fields - `${dir}` becomes selectable placeholder text the
 * player tabs through - and plain text bodies work unchanged.
 */
export type OrderSnippet = { id: string; name: string; body: string };

/**
 * Snippets as they come back from storage, which is hand-editable: anything that is not a list of
 * well-formed entries is dropped rather than allowed to break the app, and a duplicated id keeps
 * its first entry - same posture as the clamps the other persisted settings run on rehydrate.
 */
export function normalizeSnippets(value: unknown): OrderSnippet[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();
  const kept: OrderSnippet[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    const { id, name, body } = entry as Record<string, unknown>;
    if (typeof id !== "string" || typeof name !== "string" || typeof body !== "string") {
      continue;
    }
    // Trimmed the way the dialog stores them, and held to the dialog's own rules: a name the
    // popup could never match or a body whose insertion would eat the typed word must not come
    // back through the side door of hand-edited storage. Names dedupe case-insensitively for
    // the same reason the dialog refuses them: two entries differing only in case are
    // indistinguishable where they are offered.
    const trimmed = name.trim();
    if (
      id === "" ||
      seenIds.has(id) ||
      seenNames.has(trimmed.toLowerCase()) ||
      snippetNameProblem(trimmed, []) !== null ||
      snippetBodyProblem(body) !== null
    ) {
      continue;
    }
    seenIds.add(id);
    seenNames.add(trimmed.toLowerCase());
    kept.push({ id, name: trimmed, body });
  }
  return kept;
}

/**
 * What is wrong with a proposed snippet name, or null when nothing is.
 *
 * Case-insensitive against the existing names, because the completion popup matches
 * case-insensitively: two snippets differing only in case would be indistinguishable there.
 * `editingId` lets a snippet keep its own name while its body is being edited.
 */
export function snippetNameProblem(
  name: string,
  existing: readonly OrderSnippet[],
  editingId?: string
): string | null {
  const trimmed = name.trim();
  if (trimmed === "") {
    return "a snippet needs a name";
  }
  // The popup matches a word: a letter, then letters, digits, hyphens or underscores. A name
  // outside that shape would save fine and be permanently uninsertable, with nothing to say why.
  if (!/^[A-Za-z][\w-]*$/.test(trimmed)) {
    return "a snippet name is one word: a letter, then letters, digits, - or _";
  }
  const taken = existing.some(
    (snippet) => snippet.id !== editingId && snippet.name.toLowerCase() === trimmed.toLowerCase()
  );
  return taken ? `there is already a snippet called ${trimmed}` : null;
}

/**
 * What is wrong with a proposed snippet body, or null when nothing is. Only emptiness: accepting
 * a snippet with nothing in it would replace the typed word with nothing - a completion popup
 * acting as a delete key.
 */
export function snippetBodyProblem(body: string): string | null {
  return body.trim() === "" ? "a snippet needs at least one order in it" : null;
}

/**
 * Completion over the player's snippets, at the same place command completion speaks: the first
 * word of a line. Distinctly typed as "snippet", so a snippet named like an order command is
 * visibly a snippet in the popup rather than silently shadowing the command.
 */
export function snippetCompletionSource(
  snippets: readonly OrderSnippet[],
  lookUp: CaretLookup
): CompletionSource {
  const options: Completion[] = snippets.map((entry) =>
    snippetCompletion(entry.body, { label: entry.name, type: "snippet", detail: "snippet" })
  );

  return async (context) => {
    if (options.length === 0) {
      return null;
    }
    const line = context.state.doc.lineAt(context.pos);
    const before = context.state.sliceDoc(line.from, context.pos);
    // The command position, and the core is the one thing that decides where that is (ah-vfq).
    // Anywhere else is arguments. An empty word answers only when summoned explicitly - Ctrl+Space
    // on a fresh line is how a player browses a library whose names they have forgotten, and the
    // command source answers there.
    const caret = await lookUp(before);
    if (caret.position !== "command") {
      return null;
    }
    const word = caret.word.toLowerCase();
    if (word === "" && !context.explicit) {
      return null;
    }
    const matching = options.filter((option) => option.label.toLowerCase().startsWith(word));
    if (matching.length === 0) {
      return null;
    }
    return {
      from: line.from + caret.wordStart,
      options: matching,
      // Exactly the words this source itself answers, or a result would stay alive for a word
      // it would refuse - empty included, which explicit invocation makes reachable.
      validFor: /^([A-Za-z][\w-]*)?$/
    };
  };
}
