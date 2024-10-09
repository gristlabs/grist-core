/**
 * Test of the UI for Granular Access Control, part 3.
 */
import { assert } from 'mocha-webdriver';
import * as gu from 'test/nbrowser/gristUtils';
import { setupTestSuite } from 'test/nbrowser/testUtils';

describe("AccessRules4", function() {
  this.timeout('20s');
  const cleanup = setupTestSuite();

  afterEach(() => gu.checkForErrors());

  it('allows editor to toggle a column', async function() {
    const ownerSession = await gu.session().teamSite.user('user1').login();
    const docId = await ownerSession.tempNewDoc(cleanup, undefined, {load: false});

    // Create editor for this document.
    const api = ownerSession.createHomeApi();
    await api.updateDocPermissions(docId, { users: {
      [gu.translateUser("user2").email]: 'editors',
    }});

    await api.applyUserActions(docId, [
      // Now create a structure.
      ['RemoveTable', 'Table1'],
      ['AddTable', 'Table1', [
        {id: 'Toggle', type: 'Bool'},
        {id: 'Another', type: 'Text'},
        {id: 'User_Access', type: 'Text', formula: 'user.Email', isFormula: false},
      ]],
      // Now add access rules for Table2
      ['AddRecord', '_grist_ACLResources', -1, {tableId: 'Table1', colIds: '*'}],
      // Owner can do anything
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -1, aclFormula: 'user.Access == OWNER', permissionsText: 'all',
      }],
      // User with an his email address in the User_Access column can do anything
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -1, aclFormula: 'user.Email == rec.User_Access', permissionsText: 'all',
      }],
      // Otherwise no access
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -1, aclFormula: '', permissionsText: 'none',
      }],
    ]);
    await ownerSession.loadDoc(`/doc/${docId}`);

    // Make sure we can edit this as an owner.
    await gu.sendCommand('insertRecordAfter');

    assert.isEmpty(await gu.getCell('Another', 1).getText());
    assert.equal(await gu.getCell('User_Access', 1).getText(), gu.translateUser('user1').email);
    assert.isFalse(await gu.getCell('Toggle', 1).find('.widget_checkmark').isDisplayed());


    await gu.getCell('Another', 1).click();
    await gu.enterCell('owner');
    await gu.getCell('Toggle', 1).mouseMove();
    await gu.getCell('Toggle', 1).find('.widget_checkbox').click();
    await gu.waitForServer();

    assert.equal(await gu.getCell('Another', 1).getText(), 'owner');
    assert.equal(await gu.getCell('User_Access', 1).getText(), gu.translateUser('user1').email);
    assert.isTrue(await gu.getCell('Toggle', 1).find('.widget_checkmark').isDisplayed());


    // Now login as user2.
    const userSession = await gu.session().teamSite.user('user2').login();
    await userSession.loadDoc(`/doc/${docId}`);

    // Make sure we can edit this as an user2
    await gu.sendCommand('insertRecordAfter');

    assert.isEmpty(await gu.getCell('Another', 1).getText());
    assert.equal(await gu.getCell('User_Access', 1).getText(), gu.translateUser('user2').email);
    assert.isFalse(await gu.getCell('Toggle', 1).find('.widget_checkmark').isDisplayed());

    await gu.getCell('Another', 1).click();
    await gu.enterCell('user2');
    await gu.getCell('Toggle', 1).mouseMove();
    await gu.getCell('Toggle', 1).find('.widget_checkbox').click();
    await gu.waitForServer();

    assert.equal(await gu.getCell('Another', 1).getText(), 'user2');
    assert.equal(await gu.getCell('User_Access', 1).getText(), gu.translateUser('user2').email);
    assert.isTrue(await gu.getCell('Toggle', 1).find('.widget_checkmark').isDisplayed());
  });
});
