/**
 * The one piece of markup a finding's message may carry: an order it suggests, between backticks,
 * shown in code style (`ah-41tqi`: "TRANSPORT 5 35 PIKE would draw on the 35 your sharing units
 * hold"). Every surface that shows a message reads it through here - Problems and the region panel
 * through `ProblemMessage`, the editor's marker through `orderLint` - so none shows a raw backtick.
 *
 * Pure on purpose: `packages/shared` component tests run no effects (`ah-nass`), so the rule is
 * tested here and the renderers only map its segments.
 */

/** A run of a message: plain words, or a span to show in code style. */
export interface MessageSegment {
  text: string;
  code: boolean;
}

/**
 * `message` split on paired backticks. A backtick with no partner after it is an ordinary
 * character, so a message that never meant markup is never mangled; an empty pair adds nothing.
 */
export function messageSegments(message: string): MessageSegment[] {
  const segments: MessageSegment[] = [];
  let text = "";
  let cursor = 0;
  while (cursor < message.length) {
    const open = message.indexOf("`", cursor);
    const close = open < 0 ? -1 : message.indexOf("`", open + 1);
    if (close < 0) {
      text += message.slice(cursor);
      break;
    }
    text += message.slice(cursor, open);
    if (text !== "") {
      segments.push({ text, code: false });
      text = "";
    }
    if (close > open + 1) {
      segments.push({ text: message.slice(open + 1, close), code: true });
    }
    cursor = close + 1;
  }
  if (text !== "") {
    segments.push({ text, code: false });
  }
  return segments;
}

/** The message's words without its code markers: what a screen reader or a plain-text copy reads. */
export function plainMessage(message: string): string {
  return messageSegments(message)
    .map((segment) => segment.text)
    .join("");
}

/** Whether any part of `message` is to be shown in code style. */
export function hasCode(message: string): boolean {
  return messageSegments(message).some((segment) => segment.code);
}

/**
 * The look of a code span inside a message: the mono face and soft background of the orders
 * panel's quoted token. Whole literal, never assembled, so Tailwind sees it.
 */
export const MESSAGE_CODE_CLASS = "rounded bg-edge/40 px-1 font-mono";
