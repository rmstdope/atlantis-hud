/**
 * Which `getByRole(role, { name })` selectors in the test suite match by substring.
 *
 * Playwright matches an accessible name by substring unless `exact: true` is passed, so an
 * accessible name is a shared namespace: adding one to a new control inside an existing container
 * silently widens what every non-exact selector in that container matches. ah-1owr.3 paid a CI cycle
 * for exactly that - a reorder grip labelled "Move the Men column" made two long-standing
 * `getByRole("button", { name: "Men" })` selectors resolve to two elements each, and they failed on
 * a strict-mode violation in a spec that had nothing to do with the change.
 *
 * The remedy is exactness by default plus a ratchet, and this module is the rule both rest on. It
 * reads source text rather than a TypeScript AST on purpose: the suite writes these calls in a
 * narrow range of shapes, and taking on a parser dependency to fix a matching bug is out of
 * proportion. What it does not do is scan line by line - the formatter wraps some of these calls,
 * and a line-anchored pattern would miss them silently, which is the failure mode the rule exists
 * to prevent.
 */

/** One `getByRole(..., { name })` call that matches by substring. */
export type LooseSelector = {
  file: string;
  /** The line the `getByRole(` call starts on, 1-based. */
  line: number;
  /** The name as written, with its quotes stripped. */
  name: string;
};

/** What a deliberately loose selector writes on the line above itself. */
export const EXEMPTION_MARKER = "exact-selector-exempt:";

const CALL = "getByRole(";

/**
 * The source with every string, template, comment and regex literal blanked to spaces.
 *
 * Offsets and line breaks are preserved, so a match found in the blanked text points at the same
 * place in the real text. Everything downstream then works on code rather than on prose: a
 * `getByRole(` written inside a string or quoted in a comment is not a selector, and a `)` inside a
 * name must not close the call.
 */
function codeOnly(source: string): string {
  const out = source.split("");
  let index = 0;
  // Template literals nest: `${ `inner` }`. A stack of the quote characters currently open.
  const open: string[] = [];

  const blank = (at: number): void => {
    if (out[at] !== "\n") out[at] = " ";
  };

  while (index < source.length) {
    const char = source[index]!;
    const inside = open.at(-1);

    if (inside !== undefined) {
      if (char === "\\") {
        blank(index);
        blank(index + 1);
        index += 2;
        continue;
      }
      if (char === inside) {
        open.pop();
        blank(index);
        index += 1;
        continue;
      }
      if (inside === "`" && char === "$" && source[index + 1] === "{") {
        // Back into code until the matching brace: an interpolation can hold anything.
        open.push("}");
        blank(index);
        blank(index + 1);
        index += 2;
        continue;
      }
      if (inside === "}" && (char === '"' || char === "'" || char === "`")) {
        open.push(char);
        blank(index);
        index += 1;
        continue;
      }
      if (inside !== "}") blank(index);
      index += 1;
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      open.push(char);
      blank(index);
      index += 1;
      continue;
    }

    if (char === "/" && source[index + 1] === "/") {
      while (index < source.length && source[index] !== "\n") blank(index++);
      continue;
    }

    if (char === "/" && source[index + 1] === "*") {
      const end = source.indexOf("*/", index + 2);
      const stop = end === -1 ? source.length : end + 2;
      while (index < stop) blank(index++);
      continue;
    }

    if (char === "/" && startsARegex(source, index)) {
      blank(index++);
      let inClass = false;
      while (index < source.length) {
        const at = source[index]!;
        blank(index);
        index += 1;
        if (at === "\\") {
          blank(index);
          index += 1;
          continue;
        }
        if (at === "[") inClass = true;
        else if (at === "]") inClass = false;
        else if (at === "/" && !inClass) break;
      }
      continue;
    }

    index += 1;
  }

  return out.join("");
}

/**
 * Whether the `/` at `index` opens a regex literal rather than dividing.
 *
 * Division and regex are told apart by what precedes them, and the ambiguity is real in JavaScript.
 * Here it need only be right for the shapes this suite writes: a regex appears as an argument or a
 * property value, so the previous non-space character being one of `(,:=[!&|?{;` is enough.
 */
function startsARegex(source: string, index: number): boolean {
  let back = index - 1;
  while (back >= 0 && /\s/u.test(source[back]!)) back -= 1;
  return back < 0 || "(,:=[!&|?{;".includes(source[back]!);
}

/** The offset just past the `(` at `from`'s matching `)`, given blanked source. */
function endOfCall(code: string, from: number): number {
  let depth = 0;
  for (let at = from; at < code.length; at += 1) {
    if (code[at] === "(") depth += 1;
    else if (code[at] === ")") {
      depth -= 1;
      if (depth === 0) return at;
    }
  }
  return code.length;
}

/** Every substring-matching name selector in one file's source. */
export function looseSelectors(file: string, source: string): LooseSelector[] {
  const code = codeOnly(source);
  const found: LooseSelector[] = [];

  for (let at = code.indexOf(CALL); at !== -1; at = code.indexOf(CALL, at + 1)) {
    const start = at + CALL.length - 1;
    const end = endOfCall(code, start);
    const args = code.slice(start, end);

    const name = /\bname\s*:/u.exec(args);
    if (name === null) continue;

    // The value is read from the ORIGINAL text: the blanking that made the call findable is exactly
    // what erased the literal we now have to classify. Skipping to it has to use the original text
    // too - in the blanked text a string is indistinguishable from the whitespace before it, so a
    // pattern ending in `\s*` would run straight past the value it was looking for.
    let valueAt = start + name.index + name[0].length;
    while (valueAt < source.length && /\s/u.test(source[valueAt]!)) valueAt += 1;
    const value = source[valueAt];
    if (value === "/") continue; // a regex says what it matches already

    const literal = readLiteral(source, valueAt);
    if (literal === null) continue;
    if (literal.interpolated) continue; // built from an id, so near-unique by construction

    if (/\bexact\s*:\s*true\b/u.test(args)) continue;

    found.push({ file, line: source.slice(0, start).split("\n").length, name: literal.text });
  }

  return found;
}

/** The contents of the string or template literal at `at`, or null if there is none. */
function readLiteral(source: string, at: number): { text: string; interpolated: boolean } | null {
  const quote = source[at];
  if (quote !== '"' && quote !== "'" && quote !== "`") return null;

  let text = "";
  let interpolated = false;
  for (let index = at + 1; index < source.length; index += 1) {
    const char = source[index]!;
    if (char === "\\") {
      text += source[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (char === quote) return { text, interpolated };
    if (quote === "`" && char === "$" && source[index + 1] === "{") interpolated = true;
    text += char;
  }
  return null;
}

/**
 * The loose selectors that have not said why they are loose.
 *
 * A deliberately loose selector exists - a container's accessible name is built from everything
 * inside it, so it can never equal the label of one child - and the point is to tell those apart
 * from the ones that simply forgot. An `// exact-selector-exempt: <reason>` line in the comment
 * block directly above is that statement: one line, greppable, and next to the selector rather than
 * in a list somewhere that nobody opens.
 */
export function unexplainedSelectors(file: string, source: string): LooseSelector[] {
  const lines = source.split("\n");
  return looseSelectors(file, source).filter((selector) => !isExempt(lines, selector.line));
}

/** Whether the comment block immediately above `line` (1-based) grants an exemption. */
function isExempt(lines: string[], line: number): boolean {
  // Upwards while the lines are still comments: a reason worth writing rarely fits on one line, and
  // the formatter may reflow it so the marker is no longer on the line nearest the selector.
  for (let above = line - 2; above >= 0; above -= 1) {
    const text = (lines[above] ?? "").trim();
    if (!text.startsWith("//")) return false;
    if (text.includes(EXEMPTION_MARKER)) return true;
  }
  return false;
}

/**
 * What to tell somebody who has never heard of this rule.
 *
 * They are adding an unrelated feature and a test they did not write has just failed, so the
 * message has to carry the whole story: where, what, what to do, and why it matters at all.
 */
export function complain(selector: LooseSelector): string {
  return [
    `${selector.file}:${selector.line} - getByRole(..., { name: ${JSON.stringify(selector.name)} }) matches by substring.`,
    `Add \`exact: true\`, or \`// ${EXEMPTION_MARKER} <why>\` above it.`,
    `Accessible names are a shared namespace: a new control named "Move the Men column" makes a`,
    `selector for "Men" match two elements and fail in a spec that has nothing to do with the`,
    `change (ah-1owr.3).`
  ].join("\n");
}
