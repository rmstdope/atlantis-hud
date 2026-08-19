/**
 * Putting a faction's orders on the game server, and understanding what it said back.
 *
 * The whole of the logic is here and pure: building the multipart body the server's own form
 * posts, judging whether a password can be sent at all, and reading an outcome out of the HTML the
 * server answers with. Performing the request is a shell's job - only the desktop has one, because
 * `atlantis-pbem.com` sends no CORS headers and a browser could never read the reply.
 *
 * **The response body is secret.** The accepted page echoes the whole orders document back, and its
 * first line is `#atlantis <id> "<password>"` in cleartext. So a reply is never logged, never
 * stored, and never put in an `Error`; the only things a player is ever shown are what the two
 * narrow extractors below return, neither of which can reach that header line.
 */

/** One prepared upload, ready for a shell to put on the wire. */
export type OrdersUpload = {
  url: string;
  contentType: string;
  body: string;
};

/** What a shell got back. `body` is secret: it echoes the orders, password and all. */
export type OrdersUploadReply = {
  status: number;
  body: string;
};

/** The desktop shell's HTTP port. Rejects when the request could not be made at all. */
export type OrdersUploader = (
  upload: OrdersUpload,
  signal: AbortSignal
) => Promise<OrdersUploadReply>;

/** What the player is told. Never carries the response body. */
export type OrdersUploadOutcome =
  | { kind: "accepted"; serverReport: string | null }
  | { kind: "refused"; reason: string | null }
  | { kind: "unreachable" };

/**
 * The multipart body the server's upload form posts, byte for byte.
 *
 * Hand-built rather than delegated to `FormData`, so what goes on the wire is exactly what a unit
 * test pins: `FormData` would leave the encoding to whatever the HTTP plugin does with a `Request`
 * body, which is neither verified here nor testable without a network. CRLF throughout, as RFC 7578
 * requires, and the three parts in the order the real form submits them.
 *
 * The boundary is a parameter rather than generated here, both so tests are deterministic and so
 * the caller can pick one that cannot occur in the orders text.
 */
export function ordersUploadBody(
  factionId: string,
  password: string,
  ordersText: string,
  boundary: string
): { contentType: string; body: string } {
  // Everything interpolated below sits in a format whose only structure is line breaks and the
  // boundary, so a value carrying either could forge a part - a password ending a part early and
  // opening a `factionId` of its own, say. Refused here rather than trusted to a caller: this
  // function is the one place that knows what would break.
  if (!passwordIsSendable(password)) {
    throw new Error("This password cannot be sent as it is written.");
  }
  if (!/^\d+$/.test(factionId)) {
    throw new Error("The faction id must be a plain number.");
  }
  if (ordersText.includes(boundary) || password.includes(boundary) || factionId.includes(boundary)) {
    throw new Error("The multipart boundary occurs in what is being sent.");
  }

  const field = (name: string, value: string): string =>
    `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;

  const orders =
    `--${boundary}\r\n` +
    'Content-Disposition: form-data; name="orders"; filename="orders.txt"\r\n' +
    "Content-Type: text/plain\r\n\r\n" +
    `${ordersText}\r\n`;

  return {
    contentType: `multipart/form-data; boundary=${boundary}`,
    body: field("factionId", factionId) + field("password", password) + orders + `--${boundary}--\r\n`
  };
}

/**
 * Whether this password can be sent at all.
 *
 * A line break is refused for the same shape of reason as a double quote: the password is written
 * into a line of the orders document and into a multipart part, and either would let it forge a
 * line or a part of its own. A double quote is refused because the password is written back into the `#atlantis <id>
 * "<password>"` line, and the Atlantis orders format has no escape for a quote inside it - so such
 * a password would produce a header the server reads as something else entirely. Blank is refused
 * because the server would simply reject it, and saying so here is faster and clearer.
 */
export function passwordIsSendable(password: string): boolean {
  return password.trim() !== "" && !/["\r\n]/.test(password);
}

/**
 * What to tell the player, from what the server answered.
 *
 * A 200 does not mean it worked: both outcomes come back `200 OK` with an HTML page, and the
 * refusal is distinguished only by the `alert-danger` block in it. Any code treating `response.ok`
 * as success fails in the worst direction - telling a player their turn went in when the password
 * was refused.
 *
 * `unreachable` is never produced here; it is what a caller shows when the uploader itself rejects.
 */
export function interpretOrdersUploadReply(reply: OrdersUploadReply): OrdersUploadOutcome {
  const reason = refusalReason(reply.body);
  if (reason !== null || reply.status >= 400) {
    return { kind: "refused", reason };
  }
  return { kind: "accepted", serverReport: serverErrorReport(reply.body) };
}

/**
 * The `alert-danger` block, quoted either way the server might quote its class.
 *
 * Finding the block is what *classifies* the reply, so it must not depend on the block also
 * carrying an `<h3>`: a refusal whose wording moved into a `<p>`, or lost its heading entirely,
 * would otherwise read as an acceptance - the one failure direction that tells a player their turn
 * went in when it did not.
 */
const ALERT_DANGER_BLOCK = /<div[^>]*\bclass=(?:"[^"]*\balert-danger\b[^"]*"|'[^']*\balert-danger\b[^']*')[^>]*>([\s\S]*?)<\/div>/i;

/**
 * The server's own sentence for a refusal, or `null` when the page carries none.
 *
 * Its own words rather than one of ours, so the message stays right when the server changes it and
 * can explain a refusal nobody anticipated. It comes out of the `alert-danger` block, which is far
 * from the echoed orders, so it can never carry the password.
 */
export function refusalReason(body: string): string | null {
  const block = ALERT_DANGER_BLOCK.exec(body)?.[1];
  if (block === undefined) {
    return null;
  }

  // The `<h3>` is where the server puts the sentence today, so it is preferred - but only one found
  // *inside* the block, and the block's own text is the fallback, so a page that moves the wording
  // still yields it rather than quoting some unrelated heading further down the page.
  const heading = /<h3[^>]*>([\s\S]*?)<\/h3>/i.exec(block)?.[1];
  const text = collapse(decodeEntities(stripTags(heading ?? block)));
  return text === "" ? null : text;
}

/**
 * What the server said about the orders themselves - "No errors found.", or the errors it found.
 *
 * Only the tail of the echoed `<pre>`, after the **last** `#end` line, and that is what keeps the
 * password out of it: the `#atlantis` header is the first line of that block, so a function that
 * starts after `#end` can never reach it. It must never be widened to return the whole `<pre>`.
 */
export function serverErrorReport(body: string): string | null {
  // The echo is the `<pre>` carrying the document's closing directive, which is not always the
  // first one on the page - a usage block above it would otherwise swallow the whole report.
  const pre = [...body.matchAll(/<pre[^>]*>([\s\S]*?)<\/pre>/gi)]
    .map((match) => match[1])
    .find((candidate) => END_LINE.test(candidate));
  if (pre === undefined) {
    return null;
  }

  const lines = decodeEntities(stripTags(pre)).split("\n");
  const end = lines.map((line) => line.trim()).lastIndexOf("#end");
  const tail = lines
    .slice(end + 1)
    // The tail-only rule alone is not enough: a document holding a second faction block, or one
    // missing its final `#end`, puts an `#atlantis <id> "<password>"` line after the last `#end`.
    // Dropping the header positively is what actually keeps the password out of what a player sees.
    .filter((line) => !FACTION_HEADER_LINE.test(line))
    .join("\n")
    .trim();
  return tail === "" ? null : tail;
}

const END_LINE = /^[ \t]*#end[ \t]*$/m;
const FACTION_HEADER_LINE = /^\s*#atlantis\b/;

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, "");
}

function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&");
}

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
