var assert = require("assert");

var clientUtil = require("../clientUtil");
var tableUtil = require("app/client/lib/tableUtil");

// Fragments below mirror the HTML Excel places on the clipboard (CF_HTML): long lines of the
// HTML source are folded by replacing a space with CRLF plus indenting spaces, and genuine
// in-cell line breaks are encoded as <br> elements.
describe("tableUtil", function() {
  clientUtil.setTmpMochaGlobals();

  describe("parsePasteHtml", function() {
    it("should unfold Excel line-wrapped long cells without inserting newlines", function() {
      const long = "This is a plain text sentence that is definitely longer than forty " +
        "characters in one cell";
      const html =
        "<table border=0 cellpadding=0 cellspacing=0>\r\n" +
        " <col width=64 style='width:48pt'>\r\n" +
        " <tr height=19 style='height:14.4pt'>\r\n" +
        "  <td height=19 width=64 style='height:14.4pt;width:48pt'>This is a plain text\r\n" +
        "  sentence that is definitely longer than forty characters in one cell</td>\r\n" +
        " </tr>\r\n" +
        " <tr height=19 style='height:14.4pt'>\r\n" +
        "  <td height=19 style='height:14.4pt'>short</td>\r\n" +
        " </tr>\r\n" +
        " <tr height=19 style='height:14.4pt'>\r\n" +
        "  <td height=19 style='height:14.4pt'>This is a plain text sentence that is\r\n" +
        "  definitely longer than forty characters in one cell</td>\r\n" +
        " </tr>\r\n" +
        "</table>";
      const result = tableUtil.parsePasteHtml(html);
      assert.deepEqual(result.map(row => row.map(cell => cell.displayValue)), [[long], ["short"], [long]]);
      for (const row of result) {
        for (const cell of row) {
          assert(!cell.displayValue.includes("\n"), `unexpected newline in ${JSON.stringify(cell)}`);
        }
      }
    });

    it("should preserve genuine Excel in-cell line breaks encoded as <br>", function() {
      const html =
        "<table border=0 cellpadding=0 cellspacing=0>\r\n" +
        " <tr height=19 style='height:14.4pt'>\r\n" +
        "  <td height=19 width=64 style='height:14.4pt;width:48pt'>First line here<br\r\n" +
        "  />\r\n" +
        "    Second line indented with three spaces after newline test here</td>\r\n" +
        " </tr>\r\n" +
        "</table>";
      const result = tableUtil.parsePasteHtml(html);
      assert.deepEqual(result.map(row => row.map(cell => cell.displayValue)),
        [["First line here\nSecond line indented with three spaces after newline test here"]]);
    });

    it("should leave bare line breaks without indenting spaces alone", function() {
      const html = "<table><tr><td>line1\nline2</td></tr></table>";
      const result = tableUtil.parsePasteHtml(html);
      assert.deepEqual(result.map(row => row.map(cell => cell.displayValue)), [["line1\nline2"]]);
    });

    it("should preserve Grist table cell text exactly, including newline-plus-spaces", function() {
      const html = "<table data-grist-doc-id-hash=\"abc\"><col>" +
        "<tr><td>line1\n  indented</td></tr></table>";
      const result = tableUtil.parsePasteHtml(html);
      assert.deepEqual(result.map(row => row.map(cell => cell.displayValue)), [["line1\n  indented"]]);
    });
  });
});
