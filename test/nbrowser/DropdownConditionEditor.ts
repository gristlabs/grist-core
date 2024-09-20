import {UserAPI} from 'app/common/UserAPI';
import {assert, driver, Key} from 'mocha-webdriver';
import * as gu from 'test/nbrowser/gristUtils';
import {setupTestSuite} from 'test/nbrowser/testUtils';

describe('DropdownConditionEditor', function () {
  this.timeout(20000);
  const cleanup = setupTestSuite();
  let api: UserAPI;
  let docId: string;

  before(async () => {
    const session = await gu.session().user('user1').login();
    api = session.createHomeApi();
    docId = (await session.tempDoc(cleanup, 'DropdownCondition.grist')).id;
    await api.updateDocPermissions(docId, {users: {
      [gu.translateUser('user2').email]: 'editors',
    }});
    await addUserAttributes();
    await gu.openPage('Employees');
    await gu.openColumnPanel();
  });

  afterEach(() => gu.checkForErrors());

  async function addUserAttributes() {
    await api.applyUserActions(docId, [
      ['AddTable', 'Roles', [{id: 'Email'}, {id: 'Admin', type: 'Bool'}]],
      ['AddRecord', 'Roles', null, {Email: gu.translateUser('user1').email, Admin: true}],
      ['AddRecord', 'Roles', null, {Email: gu.translateUser('user2').email, Admin: false}],
    ]);
    await driver.find('.test-tools-access-rules').click();
    await gu.waitForServer();
    await driver.findContentWait('button', /Add User Attributes/, 2000).click();
    const userAttrRule = await driver.find('.test-rule-userattr');
    await userAttrRule.find('.test-rule-userattr-name').click();
    await driver.sendKeys('Roles', Key.ENTER);
    await userAttrRule.find('.test-rule-userattr-attr').click();
    await driver.sendKeys('Email', Key.ENTER);
    await userAttrRule.find('.test-rule-userattr-table').click();
    await driver.findContent('.test-select-menu li', 'Roles').click();
    await userAttrRule.find('.test-rule-userattr-col').click();
    await driver.sendKeys('Email', Key.ENTER);
    await driver.find('.test-rules-save').click();
    await gu.waitForServer();
  }

  describe(`in choice columns`, function() {
    before(async () => {
      const session = await gu.session().user('user1').login();
      await session.loadDoc(`/doc/${docId}`);
    });

    it('creates dropdown conditions', async function() {
      await gu.getCell(1, 1).click();
      await driver.find('.test-field-dropdown-condition').click();
      await gu.waitAppFocus(false);
      await gu.sendKeys(await gu.selectAllKey(), Key.DELETE, 'c');
      await gu.waitToPass(async () => {
        const completions = await driver.findAll('.ace_autocomplete .ace_line', el => el.getText());
        assert.deepEqual(completions, [
          'c\nhoice\n ',
          're\nc\n.Name\n ',
          're\nc\n.Role\n ',
          're\nc\n.Supervisor\n ',
          'user.A\nc\ncess\n ',
        ]);
      });
      await gu.sendKeysSlowly('hoice not in ');
      // Attempts to reduce test flakiness by delaying input of $. Not guaranteed to do anything.
      await driver.sleep(100);
      await gu.sendKeys('$');
      await gu.waitToPass(async () => {
        // This test is sometimes flaky here. It will consistently return the wrong value, usually an array of
        // empty strings. The running theory is it's an issue in Ace editor.
        const completions = await driver.findAll('.ace_autocomplete .ace_line', el => el.getText());
        assert.deepEqual(completions, [
          '$\nName\n ',
          '$\nRole\n ',
          '$\nSupervisor\n ',
        ]);
      });
      await gu.sendKeys('Role', Key.ENTER);
      await gu.waitForServer();
      assert.equal(
        await driver.find('.test-field-dropdown-condition').getText(),
        'choice not in $Role'
      );

      // Check that autocomplete values are filtered.
      await gu.sendKeys(Key.ENTER);
      assert.deepEqual(await driver.findAll('.test-autocomplete li', (el) => el.getText()), [
        'Supervisor',
      ]);
      await gu.sendKeys(Key.ESCAPE);
      await gu.getCell(1, 4).click();
      await gu.sendKeys(Key.ENTER);
      assert.deepEqual(await driver.findAll('.test-autocomplete li', (el) => el.getText()), [
        'Trainee',
      ]);
      await gu.sendKeys(Key.ESCAPE);
      await gu.getCell(1, 6).click();
      await gu.sendKeys(Key.ENTER);
      assert.deepEqual(await driver.findAll('.test-autocomplete li', (el) => el.getText()), [
        'Trainee',
        'Supervisor',
      ]);
      await gu.sendKeys(Key.ESCAPE);

      // Change the column type to Choice List and check values are still filtered.
      await gu.setType('Choice List', {apply: true});
      assert.equal(
        await driver.find('.test-field-dropdown-condition').getText(),
        'choice not in $Role'
      );
      await gu.getCell(1, 4).click();
      await gu.sendKeys(Key.ENTER);
      assert.deepEqual(await driver.findAll('.test-autocomplete li', (el) => el.getText()), [
        'Trainee',
      ]);
      await gu.sendKeys(Key.ESCAPE);
    });

    it('removes dropdown conditions', async function() {
      await driver.find('.test-field-dropdown-condition').click();
      await gu.sendKeys(await gu.selectAllKey(), Key.DELETE, Key.ENTER);
      await gu.waitForServer();

      // Check that autocomplete values are no longer filtered.
      await gu.sendKeys(Key.ENTER);
      assert.deepEqual(await driver.findAll('.test-autocomplete li', (el) => el.getText()), [
        'Trainee',
        'Supervisor',
      ]);
      await gu.sendKeys(Key.ESCAPE);

      // Change the column type back to Choice and check values are still no longer filtered.
      await gu.setType('Choice', {apply: true});
      assert.isFalse(await driver.find('.test-field-dropdown-condition').isPresent());
      await gu.sendKeys(Key.ENTER);
      assert.deepEqual(await driver.findAll('.test-autocomplete li', (el) => el.getText()), [
        'Supervisor',
        'Trainee',
      ]);
      await gu.sendKeys(Key.ESCAPE);
    });

    it('reports errors', async function() {
      // Check syntax errors are reported, but not saved.
      await driver.find('.test-field-set-dropdown-condition').click();
      await gu.sendKeys('!@#$%^', Key.ENTER);
      await gu.waitForServer();
      assert.equal(
        await driver.find('.test-field-dropdown-condition-error').getText(),
        'SyntaxError invalid syntax on line 1 col 1'
      );
      await gu.reloadDoc();
      assert.isFalse(await driver.find('.test-field-dropdown-condition-error').isPresent());

      // Check compilation errors are reported and saved.
      await driver.find('.test-field-set-dropdown-condition').click();
      await gu.sendKeys('foo', Key.ENTER);
      await gu.waitForServer();
      assert.equal(
        await driver.find('.test-field-dropdown-condition-error').getText(),
        "Unknown variable 'foo'"
      );
      await gu.reloadDoc();
      assert.equal(
        await driver.find('.test-field-dropdown-condition-error').getText(),
        "Unknown variable 'foo'"
      );

      // Check that the autocomplete dropdown also reports an error.
      await gu.sendKeys(Key.ENTER);
      assert.equal(
        await driver.find('.test-autocomplete-no-items-message').getText(),
        'Error in dropdown condition'
      );
      await gu.sendKeys(Key.ESCAPE);
    });
  });

  describe(`in reference columns`, function() {
    before(async () => {
      const session = await gu.session().user('user1').login();
      await session.loadDoc(`/doc/${docId}`);
    });

    it('creates dropdown conditions', async function() {
      await gu.getCell(2, 1).click();
      assert.isFalse(await driver.find('.test-field-dropdown-condition').isPresent());
      await driver.find('.test-field-set-dropdown-condition').click();
      await gu.waitAppFocus(false);
      await gu.sendKeysSlowly('choice');
      await gu.waitToPass(async () => {
        const completions = await driver.findAll('.ace_autocomplete .ace_line', el => el.getText());
        assert.deepEqual(completions, [
          'choice\n ',
          'choice\n.id\n ',
          'choice\n.Name\n ',
          'choice\n.Role\n ',
          'choice\n.Supervisor\n '
        ]);
      });
      await gu.sendKeys('.Role == "Supervisor" and $Role != "Supervisor" and $id != 2', Key.ENTER);
      await gu.waitForServer();
      assert.equal(
        await driver.find('.test-field-dropdown-condition .ace_line').getAttribute('textContent'),
        'choice.Role == "Supervisor" and $Role != "Supervisor" and $id != 2\n'
      );

      // Check that autocomplete values are filtered.
      await gu.sendKeys(Key.ENTER);
      assert.deepEqual(await driver.findAll('.test-autocomplete li', (el) => el.getText()), [
        'Pavan Madilyn',
        'Marie Ziyad',
      ]);
      await gu.sendKeys(Key.ESCAPE);

      // Should be no options on row 2 because of $id != 2 part of condition.
      await gu.getCell(2, 2).click();
      await gu.sendKeys(Key.ENTER);
      assert.deepEqual(await driver.findAll('.test-autocomplete li', (el) => el.getText()), [
      ]);
      await gu.sendKeys(Key.ESCAPE);

      // Row 3 should be like row 1.
      await gu.getCell(2, 3).click();
      await gu.sendKeys(Key.ENTER);
      assert.deepEqual(await driver.findAll('.test-autocomplete li', (el) => el.getText()), [
        'Pavan Madilyn',
        'Marie Ziyad',
      ]);
      await gu.sendKeys(Key.ESCAPE);

      await gu.getCell(2, 4).click();
      await gu.sendKeys(Key.ENTER);
      assert.isEmpty(await driver.findAll('.test-autocomplete li', (el) => el.getText()));
      await gu.sendKeys(Key.ESCAPE);
      await gu.getCell(2, 6).click();
      await gu.sendKeys(Key.ENTER);
      assert.deepEqual(await driver.findAll('.test-autocomplete li', (el) => el.getText()), [
        'Marie Ziyad',
        'Pavan Madilyn',
      ]);
      await gu.sendKeys(Key.ESCAPE);

      // Change the column type to Reference List and check values are still filtered.
      await gu.setType('Reference List', {apply: true});
      assert.equal(
        await driver.find('.test-field-dropdown-condition .ace_line').getAttribute('textContent'),
        'choice.Role == "Supervisor" and $Role != "Supervisor" and $id != 2\n'
      );
      await gu.getCell(2, 4).click();
      await gu.sendKeys(Key.ENTER);
      assert.isEmpty(await driver.findAll('.test-autocomplete li', (el) => el.getText()));
      await gu.sendKeys(Key.ESCAPE);
    });

    it('removes dropdown conditions', async function() {
      await driver.find('.test-field-dropdown-condition').click();
      await gu.sendKeys(await gu.selectAllKey(), Key.DELETE, Key.ENTER);
      await gu.waitForServer();

      // Check that autocomplete values are no longer filtered.
      await gu.sendKeys(Key.ENTER);
      assert.deepEqual(await driver.findAll('.test-autocomplete li', (el) => el.getText()), [
        'Emma Thamir',
        'Holger Klyment',
        'Marie Ziyad',
        'Olivier Bipin',
        'Pavan Madilyn',
      ]);
      await gu.sendKeys(Key.ESCAPE);

      // Change the column type back to Reference and check values are still no longer filtered.
      await gu.setType('Reference', {apply: true});
      assert.isFalse(await driver.find('.test-field-dropdown-condition').isPresent());
      await gu.sendKeys(Key.ENTER);
      assert.deepEqual(await driver.findAll('.test-autocomplete li', (el) => el.getText()), [
        'Emma Thamir',
        'Holger Klyment',
        'Marie Ziyad',
        'Olivier Bipin',
        'Pavan Madilyn',
      ]);
      await gu.sendKeys(Key.ESCAPE);
    });

    it('reports errors', async function() {
      // Check syntax errors are reported, but not saved.
      await driver.find('.test-field-set-dropdown-condition').click();
      await gu.sendKeys('!@#$%^', Key.ENTER);
      await gu.waitForServer();
      assert.equal(
        await driver.find('.test-field-dropdown-condition-error').getText(),
        'SyntaxError invalid syntax on line 1 col 1'
      );
      await gu.reloadDoc();
      assert.isFalse(await driver.find('.test-field-dropdown-condition-error').isPresent());

      // Check compilation errors are reported and saved.
      await driver.find('.test-field-set-dropdown-condition').click();
      await gu.sendKeys('foo', Key.ENTER);
      await gu.waitForServer();
      assert.equal(
        await driver.find('.test-field-dropdown-condition-error').getText(),
        "Unknown variable 'foo'"
      );
      await gu.reloadDoc();
      assert.equal(
        await driver.find('.test-field-dropdown-condition-error').getText(),
        "Unknown variable 'foo'"
      );

      // Check that the autocomplete dropdown also reports an error.
      await gu.sendKeys(Key.ENTER);
      assert.equal(
        await driver.find('.test-autocomplete-no-items-message').getText(),
        'Error in dropdown condition'
      );
      await gu.sendKeys(Key.ESCAPE);

      // Check evaluation errors are also reported in the dropdown.
      await driver.find('.test-field-dropdown-condition').click();
      await gu.sendKeys(await gu.selectAllKey(), Key.DELETE, '[] not in 5', Key.ENTER);
      await gu.waitForServer();
      await gu.sendKeys(Key.ENTER);
      assert.equal(
        await driver.find('.test-autocomplete-no-items-message').getText(),
        'Error in dropdown condition'
      );
      await gu.sendKeys(Key.ESCAPE);
    });
  });

  it('supports user variable', async function() {
    // Filter dropdown values based on a user attribute.
    await gu.getCell(1, 1).click();
    await driver.find('.test-field-set-dropdown-condition').click();
    await gu.waitAppFocus(false);
    await gu.sendKeysSlowly('user.');
    await gu.waitToPass(async () => {
      const completions = await driver.findAll('.ace_autocomplete .ace_line', el => el.getText());
      assert.deepEqual(completions, [
        'user.\nAccess\n ',
        'user.\nEmail\n ',
        'user.\nIsLoggedIn\n ',
        'user.\nLinkKey.\n ',
        'user.\nName\n ',
        'user.\nOrigin\n ',
        'user.\nRoles.Admin\n ',
        'user.\nRoles.Email\n ',
        ''
      ]);
    });
    await gu.sendKeys('Roles.Admin == True', Key.ENTER);
    await gu.waitForServer();

    // Check that user1 (who is an admin) can see dropdown values.
    await gu.sendKeys(Key.ENTER);
    assert.deepEqual(await driver.findAll('.test-autocomplete li', (el) => el.getText()), [
      'Trainee',
      'Supervisor',
    ]);
    await gu.sendKeys(Key.ESCAPE);

    // Switch to user2 (who is not an admin), and check that they can't see any dropdown values.
    const session = await gu.session().user('user2').login();
    await session.loadDoc(`/doc/${docId}`);
    await gu.getCell(1, 1).click();
    await gu.sendKeys(Key.ENTER);
    assert.deepEqual(await driver.findAll('.test-autocomplete li', (el) => el.getText()), []);
    await gu.sendKeys(Key.ESCAPE);
  });
});
