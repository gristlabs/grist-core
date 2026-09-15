import "test/client/_helpers/setupI18n";

import * as Markdown from "app/client/lib/markdown";

import { assert } from "chai";
import { dom } from "grainjs";
import { popGlobals, pushGlobals } from "grainjs/dist/cjs/lib/browserGlobals";
import { JSDOM } from "jsdom";
import * as sinon from "sinon";

describe("ParseOptions", function() {
  let buildParseOptionsForm: typeof import("app/client/components/ParseOptions").buildParseOptionsForm;
  let originalDocument: any;
  let originalWindow: any;

  before(async function() {
    const jsdom = new JSDOM("<!doctype html><html><body></body></html>");
    originalDocument = (global as any).document;
    originalWindow = (global as any).window;
    (global as any).document = jsdom.window.document;
    (global as any).window = jsdom.window;
    pushGlobals(jsdom.window);
    sinon.stub(Markdown, "markdown").callsFake(source => source as string);
    ({ buildParseOptionsForm } = await import("app/client/components/ParseOptions"));
  });

  after(function() {
    sinon.restore();
    (global as any).document = originalDocument;
    (global as any).window = originalWindow;
    popGlobals();
  });

  it("renders JSON import options", function() {
    const elem = dom("div", dom.create(buildParseOptionsForm, [{
      name: "includes",
      type: "string",
      visible: true,
    }, {
      name: "excludes",
      type: "string",
      visible: true,
    }], { includes: "", excludes: "" }, () => undefined, () => undefined));

    assert.deepEqual(Array.from(elem.querySelectorAll(".test-parseopts-opt"), option => option.textContent?.trim()), [
      "Includes (list of tables separated by semicolon)",
      "Excludes (list of tables separated by semicolon)",
    ]);
  });
});
