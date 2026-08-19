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
 * The server annotates the echoed document **inline**, immediately above each offending line, and
 * puts only the summary count after `#end`. Reading the tail alone (which is what shipped, and what
 * ah-58dz was filed against) therefore reports "1 error found!" and nothing a player can act on.
 *
 * Every line returned is filtered against `FACTION_HEADER_LINE`, wherever it appears - that, and
 * not the region boundary, is what keeps the password out of what a player sees. Do not remove the
 * filter on the grounds that the header is "before the errors"; a document with a second faction
 * block puts one anywhere, and neither a leading blank line nor indentation can defeat a match on
 * the directive's name.
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
  // Filtered once, up front, so no branch below can reintroduce the header into any intermediate
  // value. Everything after this reads `safe` and never `lines`.
  const safe = lines.filter((line) => !FACTION_HEADER_LINE.test(line));

  const end = safe.map((line) => line.trim()).lastIndexOf("#end");
  const document = end === -1 ? [] : safe.slice(0, end);
  const tail = safe
    .slice(end + 1)
    .join("\n")
    .trim();

  const blocks: string[] = [];
  let lastUnit: string | null = null;
  let emittedUnit: string | null = null;
  for (let index = 0; index < document.length; index += 1) {
    const line = document[index];
    if (UNIT_LINE.test(line)) {
      lastUnit = line.trim();
      continue;
    }
    if (!ANNOTATION_LINE.test(line)) {
      continue;
    }

    const entry: string[] = [];
    if (lastUnit !== null && lastUnit !== emittedUnit) {
      // The unit heading is emitted only when it changes, so three errors in one unit read as one
      // heading and three annotations rather than the heading three times.
      entry.push(lastUnit);
      emittedUnit = lastUnit;
    }
    entry.push(line.trim());

    const next = document[index + 1];
    if (
      next !== undefined &&
      next.trim() !== "" &&
      !ANNOTATION_LINE.test(next) &&
      next.trim() !== "#end"
    ) {
      entry.push(next.replace(/\s+$/, ""));
    }
    blocks.push(entry.join("\n"));
  }

  const rendered = [...blocks, tail].filter((part) => part !== "").join("\n\n").trim();
  return rendered === "" ? null : rendered;
}

/**
 * The server's inline annotation marker. Matched on the leading `***` alone rather than on the
 * word "Error", so a reply that says `*** Warning: ... ***` - or reworded errors - is still shown
 * rather than silently dropped. Showing one line too many is the safe direction here; the failure
 * this bead fixes was showing none.
 */
const ANNOTATION_LINE = /^\s*\*\*\*/;
/** The `unit <n>` line an annotation falls under, so the player knows where to look. */
const UNIT_LINE = /^\s*unit\s+\d+/i;

const END_LINE = /^[ \t]*#end[ \t]*$/m;
const FACTION_HEADER_LINE = /^\s*#atlantis\b/i;

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
