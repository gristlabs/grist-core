import { UserAPI } from "app/common/UserAPI";
import { assert, driver, until } from "mocha-webdriver";
import * as gu from "test/nbrowser/gristUtils";
import { setupTestSuite } from "test/nbrowser/testUtils";
import { Button, button, element, label, option} from "test/nbrowser/elementUtils";

type TypeLabels = "Regular" | "Template" | "Tutorial";


describe("DocTypeConversion", function () {
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

  async function checkDisplayedLabel(typeLabel: TypeLabels) {
    // Wait in case of page reload
    await displayedLabel.wait();

    assert.equal(await displayedLabel.element().getText(), typeLabel);
  }

  async function convert(from: TypeLabels, to: TypeLabels) {
    await gu.openDocumentSettings();

    // Ensure that initial document type is the expected one.
    const displayedLabelElement = displayedLabel.element();

    // Check initially displayed label value
    await checkDisplayedLabel(from);

    // Click to open the modal
    await editButton.click();

    // Wait for modal.
    await modal.wait();

    // Select the desired Document type
    await optionByLabel[to].click();

    assert.isTrue(await optionByLabel[to]?.checked());

    // Confirm the choice
    await modalConfirm.click();

    // Wait for the page to be unloaded
    await driver.wait(until.stalenessOf(displayedLabelElement), 3000);

    // checks that the displayedLabel is now equal to convert destination
    await checkDisplayedLabel(to);
  }

  async function isRegular(){
    assert.isFalse(await saveCopyButton.present());
    assert.isFalse(await fiddleTag.present());
  }

  async function isTemplate(){
    await assertExistsButton(saveCopyButton, "Save Copy");
    assert.isTrue(await fiddleTag.visible());
  }

  async function isTutorial(){
    await assertExistsButton(saveCopyButton, "Save Copy");
    assert.isFalse(await fiddleTag.present());
  }

  it("should display the modal with only the current type selected", async function () {
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
    await isTemplate();
  });

  it('should convert from Template to Tutorial', async function() {
    await convert("Template", "Tutorial");
    await isTutorial();
  });

  it('should convert from Tutorial to Regular', async function() {
    await convert("Tutorial", "Regular");
    await isRegular();
  });

  it('should convert from Regular to Tutorial', async function() {
    await convert("Regular", "Tutorial");
    await isTutorial();
  });

  it('should convert from Tutorial to Template', async function() {
    await convert("Tutorial", "Template");
    await isTemplate();
  });

  it('should convert from Template to Regular', async function() {
    await convert("Template", "Regular");
    await isRegular();
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
    // Note that .test-tooltip may appear blank a first time,
    // hence the necessity to use waitToPass instead of findWait.
    await gu.waitToPass(async () => {
      assert.match(await driver.find('.test-tooltip').getText(), /Only available to document owners/);
    });

    // Nothing should happen on click. We click the location rather than the element, since the
    // element isn't actually clickable.
    await start.mouseMove();
    await driver.withActions(a => a.press().release());
    await driver.sleep(100);

    assert.equal(await driver.find(".test-settings-doctype-modal").isPresent(), false);
  });
});

const editButton = button('.test-settings-doctype-edit');
const saveCopyButton = button('.test-tb-share-action');
const displayedLabel = label('.test-settings-doctype-value');
const modal = element('.test-settings-doctype-modal');
const optionRegular = option('.test-settings-doctype-modal-option-regular');
const optionTemplate = option('.test-settings-doctype-modal-option-template');
const optionTutorial = option('.test-settings-doctype-modal-option-tutorial');
const optionByLabel = {
  'Tutorial': optionTutorial,
  'Template': optionTemplate,
  'Regular': optionRegular
};
const modalConfirm = button('.test-settings-doctype-modal-confirm');
const modalCancel = button('.test-settings-doctype-modal-cancel');
const fiddleTag = element('.test-fiddle-tag');
