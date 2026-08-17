import { describe, expect, it } from "vitest";
import { tableHeader, tableRows } from "./html";

/**
 * `tableRows` is the third bit of HTML handling `html.ts` needs, after `htmlToText` and
 * `preformattedText` - a table reader for the rules page's buildings table (ah-a2k.3).
 */
describe("tableRows", () => {
  it("returns the body rows of the table whose header names every heading given", () => {
    const html = `
      <table>
        <tr><th>Name</th><th>Size</th></tr>
        <tr><td>Tower</td><td>10</td></tr>
        <tr><td>Fort</td><td>50</td></tr>
      </table>
    `;

    expect(tableRows(html, ["Name", "Size"])).toEqual([
      ["Tower", "10"],
      ["Fort", "50"]
    ]);
  });

  it("chooses the second table when only its header matches", () => {
    const html = `
      <table>
        <tr><th>Skill</th><th>Level</th></tr>
        <tr><td>Fire</td><td>3</td></tr>
      </table>
      <table>
        <tr><th>Name</th><th>Mages</th></tr>
        <tr><td>Tower</td><td>0</td></tr>
      </table>
    `;

    expect(tableRows(html, ["Name", "Mages"])).toEqual([["Tower", "0"]]);
  });

  it("returns an empty array when no table's header matches", () => {
    const html = `
      <table>
        <tr><th>Skill</th><th>Level</th></tr>
        <tr><td>Fire</td><td>3</td></tr>
      </table>
    `;

    expect(tableRows(html, ["Name", "Mages"])).toEqual([]);
  });

  it("decodes links and entities inside a cell to clean text", () => {
    const html = `
      <table>
        <tr><th>Name</th><th>Note</th></tr>
        <tr><td><a href="#tower">Tower</a></td><td>Stone &amp; mortar</td></tr>
      </table>
    `;

    expect(tableRows(html, ["Name", "Note"])).toEqual([["Tower", "Stone & mortar"]]);
  });

  it("keeps a blank first cell so column positions still line up", () => {
    const html = `
      <table>
        <tr><td></td><th>Size</th><th>Mages</th></tr>
        <tr><td>Tower</td><td>10</td><td>0</td></tr>
      </table>
    `;

    expect(tableRows(html, ["Size", "Mages"])).toEqual([["Tower", "10", "0"]]);
  });
});

describe("tableHeader", () => {
  it("returns the lower-cased header cells of the matching table", () => {
    const html = `
      <table>
        <tr><td></td><th>Size</th><th>Mages</th></tr>
        <tr><td>Tower</td><td>10</td><td>0</td></tr>
      </table>
    `;

    expect(tableHeader(html, ["Size", "Mages"])).toEqual(["", "size", "mages"]);
  });

  it("returns null when no table's header matches", () => {
    const html = `
      <table>
        <tr><th>Skill</th><th>Level</th></tr>
        <tr><td>Fire</td><td>3</td></tr>
      </table>
    `;

    expect(tableHeader(html, ["Name", "Mages"])).toBeNull();
  });
});
