import { UserAPI } from "app/common/UserAPI";
//import { assert, By, driver, until } from "mocha-webdriver";
import { assert, driver, WebElementPromise } from "mocha-webdriver";
import * as gu from "test/nbrowser/gristUtils";
import { setupTestSuite } from "test/nbrowser/testUtils";

interface Button {
  click(): Promise<void>;
  element(): WebElementPromise;
  wait(): Promise<void>;
  visible(): Promise<boolean>;
  present(): Promise<boolean>;
}

describe("Document Type Conversion", function () {
  this.timeout(20000);
  const cleanup = setupTestSuite();

  let userApi: UserAPI;
  let docId: string;
  let session: gu.Session;

  before(async () => {
    session = await gu.session().teamSite.login();
    docId = await session.tempNewDoc(cleanup);
    userApi = session.createHomeApi();
  });

  async function assertExistsButton(button: Button, text: String) {
    await gu.waitToPass(async () => {
      assert.equal(await button.element().getText(), text);
    });
    assert.isTrue(await button.visible());
  }

  async function convert(from: String, to: String) {
    await gu.openDocumentSettings();

    // Check that Document type is from before any conversion was ever apply to It.
    assert.equal(await displayedLabel.element().getText(), from);

    // Click to open the modal
    await editButton.click();

    // Wait for modal.
    await modal.wait();

    let option;

    switch (to) {
      case "Regular":
        option = optionRegular;
        break;
      case "Template":
        option = optionTemplate;
        break;
      case "Tutorial":
        option = optionTutorial;
        break;
    }
    // Select the template option
    await option?.click();

    assert.isTrue(await option?.checked());

    // Confirm the choice
    await modalConfirm.click();

    await driver.sleep(3000);

    // check that the displayedLabel is now equal to convert destination
    assert.equal(await displayedLabel.element().getText(), to);
  }

  it("should allow to convert from a document type to another", async function () {
    await gu.openDocumentSettings();
    // Make sure we see the Edit button of document type conversion.
    await assertExistsButton(editButton, "Edit");

    // Check that Document type is Regular before any conversion was ever apply to It.
    assert.equal(await displayedLabel.element().getText(), "Regular");

    await editButton.click();

    // Wait for modal.
    await modal.wait();

    // We have three options.
    assert.isTrue(await optionRegular.visible());
    assert.isTrue(await optionTemplate.visible());
    assert.isTrue(await optionTutorial.visible());

    // Regular is selected cause its the current mode.
    assert.isTrue(await optionRegular.checked());
    assert.isFalse(await optionTemplate.checked());
    assert.isFalse(await optionTutorial.checked());

    // check that cancel works
    await modalCancel.click();
    assert.isFalse(await modal.present());
  });

  // If the next six tests succeed so each document type can properly be converted to every other
  it('should convert from Regular to Template', async function() {
    await convert("Regular", "Template");
    await assertExistsButton(saveCopyButton, "Save Copy");
    assert.isTrue(await fiddleTag.visible());
  });

  it('should convert from Template to Tutorial', async function() {
    await convert("Template", "Tutorial");
    await assertExistsButton(saveCopyButton, "Save Copy");
    assert.isFalse(await fiddleTag.present());
  });

  it('should convert from Tutorial to Regular', async function() {
    await convert("Tutorial", "Regular");
    assert.isFalse(await saveCopyButton.present());
    assert.isFalse(await fiddleTag.present());
  });

  it('should convert from Regular to Tutorial', async function() {
    await convert("Regular", "Tutorial");
    await assertExistsButton(saveCopyButton, "Save Copy");
    assert.isFalse(await fiddleTag.present());
  });

  it('should convert from Tutorial to Template', async function() {
    await convert("Tutorial", "Template");
    await assertExistsButton(saveCopyButton, "Save Copy");
    assert.isTrue(await fiddleTag.visible());
  });

  it('should convert from Template to Regular', async function() {
    await convert("Template", "Regular");
    assert.isFalse(await saveCopyButton.present());
    assert.isFalse(await fiddleTag.present());
  });

  it('should be disabled for non-owners', async function() {
    await userApi.updateDocPermissions(docId, {users: {
      [gu.translateUser('user2').email]: 'editors',
    }});

    const session = await gu.session().teamSite.user('user2').login();
    await session.loadDoc(`/doc/${docId}`);
    await driver.sleep(500);
    await gu.openDocumentSettings();

    const start = driver.find('.test-settings-doctype-edit');
    assert.equal(await start.isPresent(), true);

    // Check that we have an informative tooltip.
    await start.mouseMove();
    assert.match(await driver.findWait('.test-tooltip', 2000).getText(), /Only available to document owners/);

    // Nothing should happen on click. We click the location rather than the element, since the
    // element isn't actually clickable.
    await start.mouseMove();
    await driver.withActions(a => a.press().release());
    await driver.sleep(100);

    assert.equal(await driver.find(".test-settings-doctype-modal").isPresent(), false);
  });
});

const element = (testId: string) => ({
  element() {
    return driver.find(testId);
  },
  async wait() {
    await driver.findWait(testId, 1000);
  },
  async visible() {
    return await this.element().isDisplayed();
  },
  async present() {
    return await this.element().isPresent();
  }
});

const label = (testId: string) => ({
  ...element(testId),
  async text() {
    return this.element().getText();
  },
});

const button = (testId: string) => ({
  ...element(testId),
  async click() {
    await gu.scrollIntoView(this.element());
    await this.element().click();
  },
});

const option = (testId: string) => ({
  ...button(testId),
  async checked() {
    return 'true' === await this.element().findClosest("label").find("input[type='checkbox']").getAttribute('checked');
  }
});

const editButton = button('.test-settings-doctype-edit');
const saveCopyButton = button('.test-tb-share-action');
const displayedLabel = label('.test-settings-doctype-value');
const modal = element('.test-settings-doctype-modal');
const optionRegular = option('.test-settings-doctype-modal-option-regular');
const optionTemplate = option('.test-settings-doctype-modal-option-template');
const optionTutorial = option('.test-settings-doctype-modal-option-tutorial');
const modalConfirm = button('.test-settings-doctype-modal-confirm');
const modalCancel = button('.test-settings-doctype-modal-cancel');
const fiddleTag = element('.test-fiddle-tag');
