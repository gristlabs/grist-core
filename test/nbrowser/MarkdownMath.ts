import * as gu from "test/nbrowser/gristUtils";
import { setupTestSuite } from "test/nbrowser/testUtils";

import { assert, driver, WebElement } from "mocha-webdriver";

describe("MarkdownMath", function() {
  this.timeout(20000);
  const cleanup = setupTestSuite();

  afterEach(() => gu.checkForErrors());

  before(async function() {
    const session = await gu.session().teamSite.login();
    const docId = await session.tempNewDoc(cleanup, "MarkdownMath", { load: false });
    await session.createHomeApi().applyUserActions(docId, [
      ["ModifyColumn", "Table1", "A", { widgetOptions: JSON.stringify({ widget: "Markdown" }) }],
      ["BulkAddRecord", "Table1", [null, null, null, null], { A: [
        "Area is $\\pi r^2$",
        "Water is $\\ce{H2O}$",
        "$\\text{</annotation><script>alert(1)</script>}$",
        deeplyNested,
      ] }],
    ]);
    await session.loadDoc(`/doc/${docId}`);
  });

  it("renders math and chemistry with the accessible copy intact", async function() {
    const math = await gu.getCell({ rowNum: 1, col: 0 }).findWait(".katex", 2000);
    assert.equal(await textContent(math.find(".katex-html")), "πr2");
    assert.equal(await math.find(".katex-html").getAttribute("aria-hidden"), "true");
    assert.equal(await textContent(math.find("math mrow")), "πr2");
    assert.equal(await textContent(math.find("math mrow msup mn")), "2");
    assert.equal(await textContent(math.find("math annotation")), "\\pi r^2");

    const chem = gu.getCell({ rowNum: 2, col: 0 }).find(".katex");
    assert.equal(await chem.find(".katex-error").isPresent(), false);
    assert.match(await textContent(chem.find(".katex-html")), /^H.*2.*O$/);
    assert.deepEqual(await chem.findAll("math mrow > mi", textContent), ["H", "O"]);
    assert.equal(await textContent(chem.find("math mrow msub mn")), "2");
    assert.equal(await textContent(chem.find("math annotation")), "\\ce{H2O}");
  });

  it("keeps TeX that tries to break out of the annotation as text", async function() {
    const cell = gu.getCell({ rowNum: 3, col: 0 });
    assert.equal(await textContent(cell.find("math annotation")),
      "\\text{</annotation><script>alert(1)</script>}");
    assert.equal(await cell.find(".katex").isPresent(), true);
    assert.equal(await cell.find("script").isPresent(), false);   // Script tag does not appear.
  });

  it("falls back to raw text when KaTeX overflows the stack", async function() {
    const cell = gu.getCell({ rowNum: 4, col: 0 });
    assert.equal(await cell.find(".katex").isPresent(), false);
    assert.equal(await textContent(cell), deeplyNested);
  });

  it("strips a script from annotation markup", async function() {
    // The cell renderer allows <semantics> and <annotation> through the sanitizer. Check in the real
    // browser that this sanitizes script tags on its own (previous test case checked that katex
    // also doesn't let scripts through).
    const html: string = await driver.executeAsyncScript(async function(done: (html: string) => void) {
      await (window as any).exposeModulesForTests();
      const { sanitizeHTMLIntoDOM } = (window as any).exposedModules.sanitizeHTML;
      const payload = "<math><semantics><mrow><mi>x</mi></mrow>" +
        "<annotation encoding=\"text/html\"><script>alert(1)</script>x</annotation></semantics></math>";
      const once = document.createElement("div");
      once.appendChild(sanitizeHTMLIntoDOM(payload, { ADD_TAGS: ["semantics", "annotation"] }));
      done(once.innerHTML);
    });
    assert.equal(html, "<math><semantics><mrow><mi>x</mi></mrow>" +
    "<annotation encoding=\"text/html\">x</annotation></semantics></math>");
  });
});

// Enough nesting to overflow the stack inside KaTeX, which its throwOnError option doesn't catch.
const deeplyNested = "$" + "{".repeat(5000) + "x" + "}".repeat(5000) + "$";

// Helper to return text content even if invisible (getText() only returns visible text).
function textContent(elem: WebElement) {
  return elem.getAttribute("textContent");
}
