/**
 * Test the intro screen of access rules, and how rules are first enabled and disabled.
 */
import { UserAPI } from 'app/common/UserAPI';
import { assertChanged, assertSaved, enterRulePart, findDefaultRuleSetWait} from 'test/nbrowser/aclTestUtils';
import { assert, driver, WebElement } from 'mocha-webdriver';
import * as gu from 'test/nbrowser/gristUtils';
import { setupTestSuite } from 'test/nbrowser/testUtils';

describe("AccessRulesIntro", function() {
  this.timeout('20s');
  const cleanup = setupTestSuite();
  let mainSession: gu.Session;
  let docId: string;
  let ownerApi: UserAPI;
  let editorApi: UserAPI;

  afterEach(() => gu.checkForErrors());

  before(async function() {
    const editorSession = await gu.session().teamSite.user('user2').login();
    editorApi = editorSession.createHomeApi();

    mainSession = await gu.session().teamSite.user('user1').login();
    ownerApi = mainSession.createHomeApi();
    docId = await mainSession.tempNewDoc(cleanup, 'AccessRulesIntro', {load: false});

    // Share it with another user.
    await ownerApi.updateDocPermissions(docId, { users: {
      [gu.translateUser("user2").email]: 'editors',
    } });
  });

  it('shows intro screen when there are no rules', async function() {
    await mainSession.loadDoc(`/doc/${docId}`);

    // Open the 'Access rules' page.
    await driver.findWait('.test-tools-access-rules', 1000).click();

    // A loading spinner is OK, wait for it to go away.
    await driver.wait(async () => !(await driver.find('.test-access-rules-loading').isPresent()), 2000);

    // We expect to see an intro screen with an "Enable" button and some helpful text.
    assert.equal(await driver.find('.test-access-rules-intro').isPresent(), true);
    assert.match(await driver.find('.test-access-rules-intro').getText(),
      /Access Rules.*For more granular control/s);
    assert.match(await driver.find('.test-access-rules-intro a[href*="/access-rules"]').getText(),
      /Learn more/);
    const enableButton = driver.find('.test-enable-access-rules');
    assert.equal(await enableButton.isPresent(), true);

    // Go on and click 'Enable' the rules.
    await enableButton.click();

    // We get a dialog, and can cancel or confirm.
    assert.match(await driver.findWait('.test-modal-title', 200).getText(), /Enable Access Rules/);
    await driver.findWait('.test-modal-cancel', 200).click();         // Cancel
    await driver.findWait('.test-enable-access-rules', 200).click();  // Open again
    await driver.findWait('.test-modal-confirm', 200).click();        // Confirm

    // Now we should see the access rules page.
    await driver.findWait('.test-rule-set', 200);

    // Wait for validity checking to complete.
    await gu.waitForServer();
  });

  const getChecked = (elem: WebElement) => elem.find('.test-rule-special-checkbox').getAttribute('checked');

  it("should show useful special rules by default", async function() {
    // Continuing from the previous page, we are on a brand new access rules page; unsaved.

    // We expect to see 3 checkboxes for special rules, one of them isn't yet shown.
    assert.lengthOf(await driver.findAll('.test-rule-special'), 4);
    assert.equal(await driver.find('.test-rule-special-SeedRule').isDisplayed(), true);
    assert.equal(await driver.find('.test-rule-special-SchemaEdit').isDisplayed(), true);
    assert.equal(await driver.find('.test-rule-special-AccessRules').isDisplayed(), true);
    assert.equal(await driver.find('.test-rule-special-DocCopies').isDisplayed(), false);

    // All of them should be unchecked.
    assert.equal(await getChecked(driver.find('.test-rule-special-SeedRule')), null);
    assert.equal(await getChecked(driver.find('.test-rule-special-SchemaEdit')), null);
    assert.equal(await getChecked(driver.find('.test-rule-special-AccessRules')), null);
    assert.equal(await getChecked(driver.find('.test-rule-special-DocCopies')), null);

    // Check that "Special rules for template" start collapsed by default, but can be shown.
    assert.match(await driver.find('.test-special-rules-templates').getText(),
      /Special rules for templates/);
    assert.equal(await driver.find('.test-rule-special-FullCopies').isPresent(), false);
    await driver.find('.test-special-rules-templates-expand').click();
    assert.equal(await driver.find('.test-rule-special-FullCopies').isPresent(), true);

    // Once shown this rule is also unchecked initially.
    assert.equal(await getChecked(driver.find('.test-rule-special-FullCopies')), null);

    // Save the rules (they start out unsaved).
    await saveRules();

    // Now reload and check that we still see the same thing.
    await driver.navigate().refresh();
    await driver.findWait('.test-rule-set', 5000);
    assert.equal(await getChecked(driver.find('.test-rule-special-SeedRule')), null);
    assert.equal(await getChecked(driver.find('.test-rule-special-SchemaEdit')), null);
    assert.equal(await getChecked(driver.find('.test-rule-special-AccessRules')), null);
    assert.equal(await getChecked(driver.find('.test-rule-special-DocCopies')), null);
    await driver.find('.test-special-rules-templates-expand').click();
    assert.equal(await getChecked(driver.find('.test-rule-special-FullCopies')), null);
  });

  it("should expand the special rules for templates if any are set", async function() {
    // Toggle the "FullCopies" rule to ON
    await gu.scrollIntoView(driver.find('.test-rule-special-FullCopies .test-rule-special-checkbox')).click();

    // Save and reload.
    await saveRules();
    await driver.navigate().refresh();
    await driver.findWait('.test-rule-set', 5000);

    // Check that the special template rules are expanded and the rule we turned on is visibly on.
    assert.equal(await driver.find('.test-rule-special-FullCopies').isPresent(), true);
    assert.equal(await getChecked(driver.find('.test-rule-special-FullCopies')), "true");

    // Undo.
    await gu.undo();

    // Check that it's off now.
    if (!await driver.find('.test-rule-special-FullCopies').isPresent()) {
      await driver.find('.test-special-rules-templates-expand').click();
    }
    assert.equal(await getChecked(driver.find('.test-rule-special-FullCopies')), null);
    await assertSaved();
  });

  it("should show the rule restricting copying when access rules are allowed", async function() {
    // Check that DocCopies isn't visible. We hide it because it has no effect when Access Rules
    // permission is denied.
    assert.equal(await driver.find('.test-rule-special-DocCopies').isDisplayed(), false);

    // Check that initially, once access rules are present, only owner can download a document.
    await assert.isFulfilled((await ownerApi.getWorkerAPI(docId)).downloadDoc(docId));
    await assert.isRejected((await editorApi.getWorkerAPI(docId)).downloadDoc(docId), /Forbidden/);

    // Toggle the "Access Rules" permission to ON.
    assert.equal(await getChecked(driver.find('.test-rule-special-AccessRules')), null);
    await driver.find('.test-rule-special-AccessRules .test-rule-special-checkbox').click();
    assert.equal(await getChecked(driver.find('.test-rule-special-AccessRules')), "true");

    // Now the DocCopies rule should become visible.
    assert.equal(await driver.find('.test-rule-special-DocCopies').isDisplayed(), true);

    // And it should immediately be checked (the checkbox here is a negative, it represents that
    // copies and downloads are restricted).
    assert.equal(await getChecked(driver.find('.test-rule-special-DocCopies')), "true");

    // Save the changes.
    await saveRules();

    // Though editors can now see all data AND can see access rules, there is still a restriction
    // on copies.
    await assert.isFulfilled((await ownerApi.getWorkerAPI(docId)).downloadDoc(docId));
    await assert.isRejected((await editorApi.getWorkerAPI(docId)).downloadDoc(docId), /Forbidden/);

    // Now remove the restriction.
    await driver.find('.test-rule-special-DocCopies .test-rule-special-checkbox').click();
    assert.equal(await getChecked(driver.find('.test-rule-special-DocCopies')), null);
    await saveRules();

    // Now finally editors can also download the doc.
    await assert.isFulfilled((await ownerApi.getWorkerAPI(docId)).downloadDoc(docId));
    await assert.isFulfilled((await editorApi.getWorkerAPI(docId)).downloadDoc(docId));

    // Undo and check that editors cannot download again.
    await gu.undo();
    await assert.isFulfilled((await ownerApi.getWorkerAPI(docId)).downloadDoc(docId));
    await assert.isRejected((await editorApi.getWorkerAPI(docId)).downloadDoc(docId), /Forbidden/);
  });

  it("should show Disable button if only checkbox rules are shown", async function() {
    // We only have checkbox rules; in this case the "Disable" button should be shown.
    assert.equal(await driver.find('.test-disable-access-rules').isPresent(), true);
    assert.equal(await driver.find('.test-disable-access-rules').isDisplayed(), true);

    // Add a regular rule. The "Disable" button should disappear. The idea is: there are other
    // "trash" icons visible to delete other rules, and deleting them en masse is very risky.
    await driver.findContentWait('button', /Add table rules/, 2000).click();
    await gu.findOpenMenuItem('li', /Table1/, 500).click();
    await enterRulePart(findDefaultRuleSetWait(/Table1/), 1, 'True', {C: 'deny'});

    // The "Disable" button should disappear.
    assert.equal(await driver.find('.test-disable-access-rules').isPresent(), false);

    // Save and check the button is still not shown.
    await saveRules();
    assert.equal(await driver.find('.test-disable-access-rules').isPresent(), false);

    // Delete the table rule. The "Disable" button should appear again.
    await findDefaultRuleSetWait(/Table1/).find('.test-rule-remove').click();
    assert.equal(await driver.find('.test-disable-access-rules').isPresent(), true);
    assert.equal(await driver.find('.test-disable-access-rules').isDisplayed(), true);

    // Save
    await saveRules();
    assert.equal(await driver.find('.test-disable-access-rules').isDisplayed(), true);
  });

  it('should allow using Disable button to remove all rules after confirmation', async function() {
    // As a reminder, when we get here, editors aren't allowed to download the full doc.
    await assert.isRejected((await editorApi.getWorkerAPI(docId)).downloadDoc(docId), /Forbidden/);

    // Click the "Disable Access Rules" button.
    await driver.find('.test-disable-access-rules').click();

    // We should get a dialog, and can cancel or confirm.
    assert.match(await driver.findWait('.test-modal-title', 200).getText(), /Disable Access Rules/);
    await driver.findWait('.test-modal-cancel', 200).click();         // Cancel
    await driver.findWait('.test-disable-access-rules', 200).click();  // Open again
    await driver.findWait('.test-modal-confirm', 200).click();        // Confirm
    await gu.waitForServer();

    // Check that we end up back on the intro screen.
    assert.equal(await driver.findWait('.test-access-rules-intro', 500).isPresent(), true);
    assert.match(await driver.find('.test-access-rules-intro').getText(),
      /Access Rules.*For more granular control/s);

    // Last we checked, editors could not download the document in full. With all rules cleared,
    // full downloads should be allowed to all collaborators again.
    await assert.isFulfilled((await editorApi.getWorkerAPI(docId)).downloadDoc(docId));
  });
});

async function saveRules() {
  await assertChanged();
  await driver.find('.test-rules-save').click();
  await gu.waitForServer();
  await assertSaved();
}
