import * as gu from "test/nbrowser/gristUtils";
import { server, setupTestSuite } from "test/nbrowser/testUtils";
import {
  assertWidgetText, codePane, editFromMenu, editor, getTyped, isOrange, isSourceOn, saveButton, setTyped,
  typeAndRun,
} from "test/nbrowser/widgetCreatorUtils";

import { assert, driver, Key } from "mocha-webdriver";

describe("WidgetCreator", function() {
  this.timeout(60000);
  gu.bigScreen();
  const cleanup = setupTestSuite();

  gu.withEnvironmentSnapshot({
    ASSISTANT_API_KEY: undefined,
    OPENAI_API_KEY: undefined,
    ASSISTANT_CHAT_COMPLETION_ENDPOINT: undefined,
  });

  afterEach(() => gu.checkForErrors());

  let session: gu.Session;
  let docId: string;

  const COUNT_CODE = `<script src="grist-plugin-api.js"></script>
<div id="out">waiting</div>
<script>
  grist.ready({ requiredAccess: "read table" });
  grist.onRecords(records => { out.textContent = "rows: " + records.length; });
</script>
`;
  const CHANGED_CODE = COUNT_CODE.replace("rows: ", "count: ");
  const BUILDER_OPTIONS = {
    customView: JSON.stringify({
      access: "full",
      url: "https://example.com/custom-widget-builder/index.html",
      widgetOptions: {
        _html: "<html><body><div id=\"out\">builder</div></body></html>",
        _js: "grist.ready({ requiredAccess: 'read table' });\n" +
          "grist.onRecords(r => { out.textContent = 'builder: ' + r.length; });",
        other: 1,
      },
    }),
  };

  before(async function() {
    session = await gu.session().teamSite.login();
    docId = await session.tempNewDoc(cleanup, "WidgetCreator");
    await gu.sendActions([
      ["BulkAddRecord", "Table1", [null, null, null], { A: ["a", "b", "c"] }],
      ["AddEmptyTable", "Table2"],
    ]);
  });

  it("adds an empty widget from the picker and opens its editor", async function() {
    await gu.openAddWidgetToPage();
    await driver.findContentWait(".test-wselect-type", /Create your own/, 500).click();
    assert.equal(await driver.find(".test-wselect-type .test-wselect-new-badge").getText(), "NEW");
    await driver.findContent(".test-wselect-table", /Table1/).click();
    assert.equal(await driver.find(".test-wselect-addBtn").getText(), "Add to page");
    await driver.find(".test-wselect-addBtn").click();
    await gu.waitForServer();
    assert.equal(await gu.getActiveSectionTitle(), "TABLE1 Custom");

    // Without the assistant, the user can only write the code, so the editor opens at once.
    await driver.findWait(".active_section .test-widget-creator-editor", 2000);
    assert.isTrue(await codePane().isDisplayed());
    assert.isTrue(await isSourceOn());
    assert.equal(await getTyped(), "");
    assert.isFalse(await driver.find(".test-widget-creator-widget").isPresent());
    assert.isFalse(await isOrange(await saveButton()));

    // Without changes, Close closes at once.
    await driver.find(".test-widget-creator-close").click();
    assert.isFalse(await editor().isPresent());
    assert.isFalse(await driver.find(".test-modal-title").isPresent());

    await driver.findWait(".active_section .test-widget-creator-nothing-yet-write", 1000).click();
    await driver.findWait(".test-widget-creator-code .ace_editor", 2000);
    await gu.waitForEditorFocus(".test-widget-creator-code .ace_text-input", 1000);
    // Typed code counts as a change at once.
    await gu.sendKeys("x");
    await gu.waitToPass(async () => {
      assert.isTrue(await isOrange(await saveButton()));
    }, 1000);
  });

  it("runs the code as it is typed, keeps it while Source is off, and saves it", async function() {
    await typeAndRun(COUNT_CODE);
    await assertWidgetText("rows: 3");
    assert.isTrue(await isOrange(await saveButton()));

    await typeAndRun(CHANGED_CODE);
    await assertWidgetText("count: 3");

    await setTyped(COUNT_CODE + "<!-- typed -->");
    await toggleSource("switch");
    assert.isFalse(await codePane().isDisplayed());
    assert.isFalse(await driver.find(".test-widget-creator-splitter").isDisplayed());
    assert.isFalse(await isSourceOn());
    await toggleSource("label");
    assert.isTrue(await codePane().isDisplayed());
    assert.isTrue(await isSourceOn());
    await toggleSource("label");
    assert.isFalse(await codePane().isDisplayed());
    await toggleSource("switch");
    assert.isTrue(await codePane().isDisplayed());
    assert.include(await getTyped(), "<!-- typed -->");

    await saveButton().click();
    await gu.waitForServer();
    assert.isFalse(await isOrange(await saveButton()));
    assert.equal(await savedCode(), COUNT_CODE + "<!-- typed -->");

    await driver.find(".test-widget-creator-close").click();
    assert.isFalse(await editor().isPresent());
    await assertWidgetText("rows: 3");
  });

  it("asks before closing or leaving the page with changes", async function() {
    await editFromMenu();
    // Typed code that was not refreshed counts as a change.
    await setTyped(CHANGED_CODE);
    await driver.find(".test-widget-creator-close").click();
    assert.equal(await driver.findWait(".test-modal-title", 1000).getText(), "Save your changes?");
    await driver.find(".test-widget-creator-dont-save").click();
    await gu.waitForServer();
    assert.isFalse(await editor().isPresent());
    await assertWidgetText("rows: 3");

    await driver.find(".active_section .test-widget-creator-widget").click();
    await editFromMenu();
    await setTyped("<p>not saved</p>");
    // Escape closes the question and keeps the page and the typed code.
    await gu.openPage(/Table2/);
    await driver.findWait(".test-widget-creator-dont-save", 2000);
    await gu.sendKeys(Key.ESCAPE);
    await gu.waitToPass(async () => assert.isFalse(await driver.find(".test-modal-dialog").isPresent()));
    assert.match(await gu.getCurrentPageName(), /Table1/);
    assert.equal(await getTyped(), "<p>not saved</p>");
    await gu.openPage(/Table2/);
    await driver.findWait(".test-widget-creator-dont-save", 2000).click();
    await gu.waitForServer();
    assert.match(await gu.getCurrentPageName(), /Table2/);
    await gu.openPage(/Table1/);
    await driver.findContentWait(".test-viewsection-title", /TABLE1 Custom/, 2000).click();
    await assertWidgetText("rows: 3");

    await editFromMenu();
    await setTyped(CHANGED_CODE);
    await driver.find(".test-widget-creator-close").click();
    await driver.findWait(".test-modal-confirm", 1000).click();
    await gu.waitForServer();
    assert.isFalse(await editor().isPresent());
    await assertWidgetText("count: 3");
    assert.equal(await savedCode(), CHANGED_CODE);
  });

  it("keeps its code away from the widget's own options", async function() {
    const iframe = await driver.findWait(".active_section .test-widget-creator-widget iframe", 2000);
    const widgetOptions = await gu.doInIframe(iframe, async () => {
      return await driver.executeAsyncScript((done: (value: unknown) => void) => {
        const grist = (window as any).grist;
        grist.clearOptions()
          .then(() => grist.setOptions({ html: "<p>replaced</p>", color: "red" }))
          .then(() => grist.getOptions())
          .then(done);
      });
    });
    assert.deepEqual(widgetOptions, { html: "<p>replaced</p>", color: "red" });

    await driver.findWait(".active_section .test-section-menu-small-btn-save", 1000).click();
    await gu.waitForServer();
    assert.deepEqual(await savedOptions(), { html: "<p>replaced</p>", color: "red" });
    assert.equal(await savedCode(), CHANGED_CODE);
  });

  it("moves a Custom Widget Builder widget to Widget Creator, with its code as one file", async function() {
    await changeBuilderToCreator();

    // The old access was granted to other code, so it goes back to "read table".
    const customView = await savedCustomView();
    assert.equal(customView.access, "read table");
    assert.isNotOk(customView.url);
    assert.deepEqual(customView.widgetOptions, { other: 1 });
    const code = await savedCode();
    assert.match(code, /^<script src="grist-plugin-api.js"><\/script><html><body>/);
    assert.include(code, "<script>\ngrist.ready({ requiredAccess: 'read table' });");
    assert.match(code, /<\/script>\n<\/body><\/html>$/);
    // The editor is closed, so the widget runs the code saved in the document.
    assert.isFalse(await editor().isPresent());
    await assertWidgetText("builder: 3");

    await editFromMenu();
    assert.equal(await getTyped(), code);
    await typeAndRun(code.replace("builder: ", "merged: "));
    await assertWidgetText("merged: 3");
    await saveButton().click();
    await gu.waitForServer();
    assert.equal(await savedCode(), code.replace("builder: ", "merged: "));
    await driver.find(".test-widget-creator-close").click();
  });

  it("shows an error of the code", async function() {
    await editFromMenu();
    await typeAndRun("<script src=\"grist-plugin-api.js\"></script>\n" +
      "<script>\n  grist.ready();\n  notDefined();\n</script>\n");
    await gu.waitToPass(async () => {
      assert.match(await driver.find(".test-widget-creator-error-text").getText(),
        /^Error on line 4: .*notDefined is not defined/);
    }, 3000);
    assert.isFalse(await driver.find(".test-widget-creator-error-send").isPresent());
    assert.isTrue(await driver.find(".test-widget-creator-error-copy").isDisplayed());
    await driver.find(".test-widget-creator-close").click();
    await driver.findWait(".test-widget-creator-dont-save", 1000).click();
  });

  it("is in Select By of other widgets only when its code allows it", async function() {
    assert.deepEqual(await selectByItems("TABLE1"), ["Select widget"]);

    await gu.selectSectionByTitle("TABLE1 Custom");
    await editFromMenu();
    await typeAndRun(COUNT_CODE.replace("grist.ready({", "grist.ready({ allowSelectBy: true,"));
    await saveButton().click();
    await gu.waitForServer();
    await driver.find(".test-widget-creator-close").click();

    assert.deepEqual(await selectByItems("TABLE1"), ["Select widget", "TABLE1 Custom"]);
  });

  it("keeps the widget code away from Grist's page and session", async function() {
    await gu.selectSectionByTitle("TABLE1 Custom");
    await editFromMenu();
    await typeAndRun(`<pre id="out">waiting</pre>
<script>
  async function attempt(name, fn) {
    try { return name + ": " + await fn(); } catch (e) { return name + ": blocked"; }
  }
  async function run() {
    out.textContent = (await Promise.all([
      attempt("parent", () => parent.document.title),
      attempt("cookie", () => document.cookie),
      attempt("storage", () => localStorage.length),
      attempt("navigate", () => { top.location.href = "about:blank"; return "done"; }),
      attempt("session", () => fetch("${server.getHost()}/api/profile/user", { credentials: "include" })
        .then(r => r.json()).then(user => user.email)),
    ])).join("\\n");
  }
</script>
<img src="x" onerror="run()">
`);
    await assertWidgetText([
      "parent: blocked",
      "cookie: blocked",
      "storage: blocked",
      "navigate: blocked",
      "session: blocked",
    ].join("\n"));
    await driver.find(".test-widget-creator-close").click();
    await driver.findWait(".test-widget-creator-dont-save", 1000).click();
  });

  it("prints the page in its frame with Print widget", async function() {
    await editFromMenu();
    await typeAndRun(`<script src="grist-plugin-api.js"></script>
<div id="out">waiting</div>
<script>
  grist.ready();
  window.print = () => { out.textContent = "printed in the frame"; };
</script>
`);
    await assertWidgetText("waiting");
    await driver.executeScript("window.print = () => { window.testPrintedPage = true; }");
    await gu.openSectionMenu("viewLayout", "TABLE1 Custom");
    await driver.findWait(".test-print-section", 500).click();
    await assertWidgetText("printed in the frame");
    assert.isNotOk(await driver.executeScript("return window.testPrintedPage"));
    await driver.find(".test-widget-creator-close").click();
    await driver.findWait(".test-widget-creator-dont-save", 1000).click();
  });

  // Print widget used to wait forever for the widget to call ready(), and nothing was printed.
  it("prints the Grist page when the code doesn't call ready", async function() {
    await editFromMenu();
    await typeAndRun(`<div id="out">no plugin api</div>`);
    await assertWidgetText("no plugin api");
    await driver.executeScript("window.print = () => { window.testPrintedPage = true; }");
    await gu.openSectionMenu("viewLayout", "TABLE1 Custom");
    await driver.findWait(".test-print-section", 500).click();
    await gu.waitToPass(async () => {
      assert.isTrue(await driver.executeScript("return window.testPrintedPage"));
    }, 2000);
    await driver.find(".test-widget-creator-close").click();
    await driver.findWait(".test-widget-creator-dont-save", 1000).click();
  });

  it("shrinks with its section when the layout leaves it little space", async function() {
    await gu.selectSectionByTitle("TABLE1");
    const tableSectionId = await gu.getSectionId();
    await gu.selectSectionByTitle("TABLE1 Custom");
    const creatorSectionId = await gu.getSectionId();
    await gu.sendActions([["UpdateRecord", "_grist_Views", 1, {
      layoutSpec: JSON.stringify({ children: [{ leaf: creatorSectionId }, { leaf: tableSectionId }] }),
    }]]);

    const creatorBox = () => gu.getSection("TABLE1 Custom").findClosest(".layout_box");
    const extraSpace = (await creatorBox().rect()).height - 100;
    await creatorBox().find(".ui-resizable-s").mouseMove();
    await driver.mouseDown();
    // A small first move, so the drag is set up before the mouse goes over the widget's iframe.
    await driver.mouseMoveBy({ y: -1 });
    await driver.mouseMoveBy({ y: -extraSpace });
    await driver.mouseUp();
    await gu.waitForServer();

    const box = await creatorBox().rect();
    assert.isBelow(box.height, 120);
    const widget = await driver.find(".test-widget-creator").rect();
    assert.isAtMost(widget.y + widget.height, box.y + box.height);
  });

  async function toggleSource(on: "switch" | "label") {
    const target = on === "switch" ?
      driver.find(".test-widget-creator-source .test-toggle-switch-circle") :
      driver.find(".test-widget-creator-source-label");
    await target.click();
    // Turning it on slides the code in; wait until it is in place.
    await gu.waitToPass(async () => {
      const code = await driver.findAll(".test-widget-creator-code");
      assert.isFalse(code.length > 0 && (await code[0].getAttribute("class")).includes("-slide-in"));
    });
  }

  // The options of the active section, as saved in the document.
  async function savedSectionOptions(): Promise<Record<string, any>> {
    const api = session.createHomeApi().getDocAPI(docId);
    const sectionId = await gu.getSectionId();
    const rows = await api.getRecords("_grist_Views_section", { filters: { id: [sectionId] } });
    return JSON.parse(rows[0].fields.options as string);
  }

  async function savedCode(): Promise<string> {
    return (await savedSectionOptions()).html ?? "";
  }

  async function savedCustomView(): Promise<Record<string, any>> {
    return JSON.parse((await savedSectionOptions()).customView);
  }

  // The widget's own options.
  async function savedOptions(): Promise<Record<string, any>> {
    return (await savedCustomView()).widgetOptions;
  }

  async function changeBuilderToCreator() {
    const sectionId = await gu.getSectionId();
    await gu.sendActions([["UpdateRecord", "_grist_Views_section", sectionId,
      { parentKey: "custom", options: JSON.stringify(BUILDER_OPTIONS) }]]);
    await gu.openWidgetPanel();
    await driver.findContent(".test-right-panel button", /Change widget/).click();
    await gu.selectWidget(/Create your own/);
    await gu.waitForServer();
  }

  async function selectByItems(section: string): Promise<string[]> {
    await gu.openSelectByForSection(section);
    const items = await gu.findOpenMenuAllItems(".test-select-row", e => e.getText());
    await gu.sendKeys(Key.ESCAPE);
    return items;
  }
});
