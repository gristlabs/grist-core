import { clickMenu, labels, plusButton, question } from "test/nbrowser/formTools";
import * as gu from "test/nbrowser/gristUtils";
import { setupTestSuite } from "test/nbrowser/testUtils";

import { assert, driver } from "mocha-webdriver";

describe("FormViewDropdownCondition", function() {
  this.timeout(20_000);
  gu.bigScreen("medium");

  const cleanup = setupTestSuite();
  const clipboard = gu.getLockableClipboard();

  afterEach(() => gu.checkForErrors());

  async function createPublishedRefForm(type: "Reference" | "Reference List") {
    const session = await gu.session().login({ showTips: true });
    await session.tempNewDoc(cleanup);
    await gu.createClipboardTextArea();

    await gu.addNewTable("Structures");
    await gu.sendActions([
      ["AddRecord", "Structures", null, { A: "Alpha", B: "Approved" }],
      ["AddRecord", "Structures", null, { A: "Beta", B: "Pending" }],
      ["AddRecord", "Structures", null, { A: "Gamma", B: "Approved" }],
    ]);
    await gu.addNewSection("Form", "Table1");

    await plusButton().click();
    await clickMenu("More");
    await clickMenu(type);
    await gu.waitForServer();
    assert.deepEqual(await labels(), ["A", "B", "C", "D"]);

    await question("D").click();
    await gu.openColumnPanel();
    await gu.setRefTable("Structures");
    await gu.setRefShowColumn("A");

    const widgetOptions = JSON.stringify({
      dropdownCondition: {
        text: 'choice.B == "Approved"',
        parsed: JSON.stringify(["Eq", ["Attr", ["Name", "choice"], "B"], ["Const", "Approved"]]),
      },
    });
    await gu.sendActions([
      ["ModifyColumn", "Table1", "D", { widgetOptions }],
    ]);

    await driver.find(".test-forms-publish").click();
    if (await driver.find(".test-modal-confirm").isPresent()) {
      await driver.find(".test-modal-confirm").click();
    }
    await gu.waitForServer();

    let formUrl = "";
    await clipboard.lockAndPerform(async (cb) => {
      const shareButton = await driver.find(".test-forms-share");
      await gu.scrollIntoView(shareButton);
      await shareButton.click();
      await gu.waitForServer();
      await driver.findWait(".test-forms-copy-link", 1000).click();
      await gu.waitToPass(async () => assert.match(
        await driver.find(".test-tooltip").getText(), /Link copied to clipboard/), 1000);
      await driver.find("#clipboardText").click();
      await gu.selectAll();
      await cb.paste();
      formUrl = await driver.find("#clipboardText").value();
    });
    await gu.removeClipboardTextArea();
    return formUrl;
  }

  it("filters Reference choices in the published form", async function() {
    const formUrl = await createPublishedRefForm("Reference");

    await gu.onNewTab(async () => {
      await driver.get(formUrl);
      await driver.findWait('select[name="D"]', 2000);
      assert.deepEqual(
        await driver.findAll('select[name="D"] option', e => e.getText()),
        ["Select...", "Alpha", "Gamma"],
      );
      await driver.find(".test-form-search-select").click();
      await driver.findWait(".test-sd-searchable-list-item", 1000);
      assert.deepEqual(
        await driver.findAll(".test-sd-searchable-list-item", e => e.getText()),
        ["Alpha", "Gamma"],
      );
    });
  });

  it("filters Reference List choices in the published form", async function() {
    const formUrl = await createPublishedRefForm("Reference List");

    await gu.onNewTab(async () => {
      await driver.get(formUrl);
      await driver.findWait('input[name="D[]"]', 2000);
      assert.deepEqual(
        await driver.findAll('input[name="D[]"] + span', e => e.getText()),
        ["Alpha", "Gamma"],
      );
    });
  });
});
