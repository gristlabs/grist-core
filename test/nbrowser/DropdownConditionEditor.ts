import {assert, driver, Key} from 'mocha-webdriver';
import * as gu from 'test/nbrowser/gristUtils';
import {setupTestSuite} from 'test/nbrowser/testUtils';

describe('DropdownConditionEditor', function () {
  this.timeout(20000);
  const cleanup = setupTestSuite();

  before(async () => {
    const session = await gu.session().login();
    await session.tempDoc(cleanup, 'DropdownCondition.grist');
    await gu.openColumnPanel();
  });

  afterEach(() => gu.checkForErrors());

  describe(`in choice columns`, function() {
    it('creates dropdown conditions', async function() {
      await gu.getCell(1, 1).click();
      assert.isFalse(await driver.find('.test-field-dropdown-condition').isPresent());
      await driver.find('.test-field-set-dropdown-condition').click();
      await gu.sendKeys('c');
      await gu.waitToPass(async () => {
        const completions = await driver.findAll('.ace_autocomplete .ace_line', el => el.getText());
        assert.deepEqual(completions, [
          'c\nhoice\n ',
          're\nc\n.Name\n ',
          're\nc\n.Role\n ',
          're\nc\n.Supervisor\n ',
        ]);
      });
      await gu.sendKeys('hoice not in $');
      await gu.waitToPass(async () => {
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
    it('creates dropdown conditions', async function() {
      await gu.getCell(2, 1).click();
      assert.isFalse(await driver.find('.test-field-dropdown-condition').isPresent());
      await driver.find('.test-field-set-dropdown-condition').click();
      await gu.sendKeys('choice');
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
      await gu.sendKeys('.Role == "Supervisor" and $Role != "Supervisor"', Key.ENTER);
      await gu.waitForServer();
      assert.equal(
        await driver.find('.test-field-dropdown-condition .ace_line').getAttribute('textContent'),
        'choice.Role == "Supervisor" and $Role != "Supervisor"\n'
      );

      // Check that autocomplete values are filtered.
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
        'choice.Role == "Supervisor" and $Role != "Supervisor"\n'
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
});
