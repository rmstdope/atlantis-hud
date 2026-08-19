import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  interpretOrdersUploadReply,
  ordersUploadBody,
  passwordIsSendable,
  refusalReason,
  serverErrorReport
} from "./ordersUpload";

function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf8");
}

const ACCEPTED = fixture("upload-accepted.html");
const REFUSED = fixture("upload-refused.html");
/** The token the fixtures' `#atlantis` line carries in place of the real password. */
const FIXTURE_PASSWORD = "REDACTED";

describe("ordersUploadBody", () => {
  it("builds the three parts the server's own form posts, in order", () => {
    const { contentType, body } = ordersUploadBody("42", "s3cret", "#atlantis 42\n#end\n", "BOUND");

    expect(contentType).toBe("multipart/form-data; boundary=BOUND");
    expect(body).toBe(
      "--BOUND\r\n" +
        'Content-Disposition: form-data; name="factionId"\r\n' +
        "\r\n" +
        "42\r\n" +
        "--BOUND\r\n" +
        'Content-Disposition: form-data; name="password"\r\n' +
        "\r\n" +
        "s3cret\r\n" +
        "--BOUND\r\n" +
        'Content-Disposition: form-data; name="orders"; filename="orders.txt"\r\n' +
        "Content-Type: text/plain\r\n" +
        "\r\n" +
        "#atlantis 42\n#end\n\r\n" +
        "--BOUND--\r\n"
    );
  });
});

describe("ordersUploadBody, refusing what it cannot encode", () => {
  it("refuses a password it could not send", () => {
    expect(() => ordersUploadBody("42", 'has"quote', "orders", "BOUND")).toThrow();
    expect(() => ordersUploadBody("42", "a\r\nb", "orders", "BOUND")).toThrow();
  });

  it("refuses a boundary that occurs in what is being sent", () => {
    expect(() => ordersUploadBody("42", "s3cret", "see --BOUND here", "BOUND")).toThrow();
  });

  it("refuses a faction id that is not a plain number", () => {
    expect(() => ordersUploadBody("42\r\nX", "s3cret", "orders", "BOUND")).toThrow();
  });
});

describe("passwordIsSendable", () => {
  it("a password containing a double quote cannot be sent", () => {
    expect(passwordIsSendable('has"quote')).toBe(false);
  });

  it("refuses a password carrying a line break, which could forge a part or a header line", () => {
    expect(passwordIsSendable("a\r\nb")).toBe(false);
    expect(passwordIsSendable("a\nb")).toBe(false);
  });

  it("refuses an empty or blank password and accepts an ordinary one", () => {
    expect(passwordIsSendable("")).toBe(false);
    expect(passwordIsSendable("   ")).toBe(false);
    expect(passwordIsSendable("secret")).toBe(true);
  });
});

describe("refusalReason", () => {
  it("reads the server's own sentence out of an alert-danger page", () => {
    expect(refusalReason(REFUSED)).toBe(
      "Faction password is incorrect. Try again or contact the Game Masters on Discord to change your password."
    );
  });

  it("carries neither the header line nor the password", () => {
    const reason = refusalReason(REFUSED) ?? "";
    expect(reason).not.toContain("#atlantis");
    expect(reason).not.toContain(FIXTURE_PASSWORD);
  });

  it("recognises the block however the server quotes its class, and wherever the wording sits", () => {
    expect(refusalReason("<div class='alert alert-danger'><h3>Password incorrect</h3></div>")).toBe(
      "Password incorrect"
    );
    expect(refusalReason('<div class="alert alert-danger"><p>Password incorrect</p></div>')).toBe(
      "Password incorrect"
    );
  });

  it("never quotes a heading from outside the block", () => {
    const body =
      '<div class="alert alert-danger"><p>bad password</p></div><h2>x</h2><h3>Unrelated heading</h3>';
    expect(refusalReason(body)).toBe("bad password");
  });

  it("is null when the page carries no alert-danger block", () => {
    expect(refusalReason(ACCEPTED)).toBeNull();
    expect(refusalReason("<html></html>")).toBeNull();
  });

  it("decodes the entities the server escapes, and collapses whitespace", () => {
    const body =
      '<div class="alert alert-danger text-center">\n  <h3>Orders &amp; report\n  &lt;rejected&gt;</h3>\n</div>';
    expect(refusalReason(body)).toBe("Orders & report <rejected>");
  });

  it("is null rather than empty when the block's h3 has no text", () => {
    expect(refusalReason('<div class="alert alert-danger"><h3>  </h3></div>')).toBeNull();
  });
});

describe("serverErrorReport", () => {
  it("reports what the server said after #end, and never the echoed password", () => {
    const report = serverErrorReport(ACCEPTED);

    expect(report).toBe("No errors found.");
    expect(report).not.toContain("#atlantis");
    expect(report).not.toContain(FIXTURE_PASSWORD);
  });

  it("takes only the tail after the LAST #end line", () => {
    const body = "<pre>#atlantis 42 &quot;p&quot;\n#end\nfirst\n#end\nOrder 3: unknown.\n</pre>";
    expect(serverErrorReport(body)).toBe("Order 3: unknown.");
  });

  it("never returns an #atlantis line, even one the document carries after #end", () => {
    // A player whose document holds a second faction block, or who forgot the final #end, puts an
    // `#atlantis <id> "<password>"` line after the last one. The tail-only rule alone does not stop
    // that reaching the player, so the header is dropped positively.
    const body =
      '<pre>#atlantis 42 &quot;topsecret&quot;\nunit 1\n#end\n#atlantis 43 &quot;othersecret&quot;\nunit 2\n</pre>';
    const report = serverErrorReport(body) ?? "";

    expect(report).not.toContain("#atlantis");
    expect(report).not.toContain("othersecret");
    expect(report).toBe("unit 2");
  });

  it("takes the pre that holds the echoed document, not merely the first on the page", () => {
    const body = "<pre>usage</pre><pre>#atlantis 1 &quot;p&quot;\n#end\nOrder 3: unknown.</pre>";
    expect(serverErrorReport(body)).toBe("Order 3: unknown.");
  });

  it("strips markup the server wrapped the tail in", () => {
    const body = "<pre class=\"x\"><code>#atlantis 1 &quot;p&quot;\n#end\nNo errors found.</code></pre>";
    expect(serverErrorReport(body)).toBe("No errors found.");
  });

  it("names the failing order and the unit it belongs to", () => {
    const body =
      "<pre>#atlantis 95 &quot;swordfish&quot;\nunit 803\nFORM 5\n  STUDY FORC\n\n" +
      '*** Error: xNAME is not a valid order. ***\n  xNAME UNIT &quot;Scouts&quot;\n  CLAIM 895\nEND\n#end\n\n1 error found!\n</pre>';

    expect(serverErrorReport(body)).toBe(
      'unit 803\n*** Error: xNAME is not a valid order. ***\n  xNAME UNIT "Scouts"\n\n1 error found!'
    );
  });

  it("never returns an #atlantis line, wherever the reply puts one", () => {
    const body =
      "<pre>#atlantis 95 &quot;swordfish&quot;\nunit 803\n\n" +
      "#atlantis 95 &quot;swordfish&quot;\n" +
      "   #atlantis 95 &quot;swordfish&quot;\n" +
      "*** Error: bad order. ***\n  XX 1\n#end\n" +
      "#atlantis 95 &quot;swordfish&quot;\n1 error found!\n</pre>";
    const report = serverErrorReport(body) ?? "";

    expect(report).not.toContain("#atlantis");
    expect(report).not.toContain("swordfish");
    expect(report).toContain("*** Error: bad order. ***");
  });

  it("drops the header however the player cased it", () => {
    // Atlantis directives are case-insensitive, so a document written `#ATLANTIS 95 "swordfish"`
    // is echoed back that way and must be filtered just the same.
    const body =
      '<pre>#ATLANTIS 95 &quot;swordfish&quot;\nunit 803\n*** Error: a. ***\n  AA 1\n#end\n1 error found!\n</pre>';
    const report = serverErrorReport(body) ?? "";

    expect(report.toLowerCase()).not.toContain("#atlantis");
    expect(report).not.toContain("swordfish");
  });

  it("groups each error under the unit it falls in", () => {
    const body =
      "<pre>#atlantis 1 &quot;p&quot;\nunit 803\n*** Error: a. ***\n  AA 1\nunit 900\n" +
      "*** Error: b. ***\n  BB 2\n#end\n2 errors found!\n</pre>";

    expect(serverErrorReport(body)).toBe(
      "unit 803\n*** Error: a. ***\n  AA 1\n\nunit 900\n*** Error: b. ***\n  BB 2\n\n2 errors found!"
    );
  });

  it("repeats the unit line only when it changes", () => {
    const body =
      "<pre>#atlantis 1 &quot;p&quot;\nunit 803\n*** Error: a. ***\n  AA 1\n" +
      "*** Error: b. ***\n  BB 2\n#end\n2 errors found!\n</pre>";

    expect(serverErrorReport(body)).toBe(
      "unit 803\n*** Error: a. ***\n  AA 1\n\n*** Error: b. ***\n  BB 2\n\n2 errors found!"
    );
  });

  it("shows an annotation before any unit line without one", () => {
    const body =
      "<pre>#atlantis 1 &quot;p&quot;\n*** Error: faction-level. ***\n  FF 1\n#end\n1 error found!\n</pre>";

    expect(serverErrorReport(body)).toBe(
      "*** Error: faction-level. ***\n  FF 1\n\n1 error found!"
    );
  });

  it("omits the offending line when the annotation is the last line", () => {
    const body = "<pre>#atlantis 1 &quot;p&quot;\nunit 5\n*** Error: a. ***\n#end\n1 error found!\n</pre>";

    expect(serverErrorReport(body)).toBe("unit 5\n*** Error: a. ***\n\n1 error found!");
  });

  it("omits it when the next line is another annotation", () => {
    const body =
      "<pre>#atlantis 1 &quot;p&quot;\nunit 5\n*** Error: a. ***\n*** Error: b. ***\n  BB 2\n#end\n2 errors found!\n</pre>";

    expect(serverErrorReport(body)).toBe(
      "unit 5\n*** Error: a. ***\n\n*** Error: b. ***\n  BB 2\n\n2 errors found!"
    );
  });

  it("shows an annotation the server did not word as an Error", () => {
    const body =
      "<pre>#atlantis 1 &quot;p&quot;\nunit 5\n*** Warning: odd. ***\n  WW 1\n#end\n1 error found!\n</pre>";

    expect(serverErrorReport(body)).toContain("*** Warning: odd. ***");
  });

  it("a clean reply is still the tail alone", () => {
    expect(serverErrorReport(ACCEPTED)).toBe("No errors found.");
  });

  it("is null when there is no pre, or nothing follows #end", () => {
    expect(serverErrorReport("<html>no pre here</html>")).toBeNull();
    expect(serverErrorReport("<pre>#atlantis 42\n#end\n</pre>")).toBeNull();
    expect(serverErrorReport("<pre>no end line at all</pre>")).toBeNull();
  });
});

describe("interpretOrdersUploadReply", () => {
  it("a 200 carrying alert-danger is a refusal, not an acceptance", () => {
    expect(interpretOrdersUploadReply({ status: 200, body: REFUSED })).toEqual({
      kind: "refused",
      reason:
        "Faction password is incorrect. Try again or contact the Game Masters on Discord to change your password."
    });
  });

  it("a 200 carrying the echoed orders is an acceptance with the server's report", () => {
    expect(interpretOrdersUploadReply({ status: 200, body: ACCEPTED })).toEqual({
      kind: "accepted",
      serverReport: "No errors found."
    });
  });

  it("any 4xx or 5xx is a refusal, with no reason when the body carries none", () => {
    expect(interpretOrdersUploadReply({ status: 500, body: "" })).toEqual({
      kind: "refused",
      reason: null
    });
  });

  it("never carries the response body in any outcome", () => {
    for (const reply of [
      { status: 200, body: ACCEPTED },
      { status: 200, body: REFUSED },
      { status: 500, body: "boom" }
    ]) {
      const outcome = interpretOrdersUploadReply(reply);
      expect(Object.keys(outcome).sort()).not.toContain("body");
      expect(JSON.stringify(outcome)).not.toContain(FIXTURE_PASSWORD);
      expect(JSON.stringify(outcome)).not.toContain("#atlantis");
    }
  });
});
