import {UserAPI} from 'app/common/UserAPI';
import {escapeRegExp} from 'lodash';
import {addToRepl, assert, driver, Key, WebElement, WebElementPromise} from 'mocha-webdriver';
import * as gu from 'test/nbrowser/gristUtils';
import {setupTestSuite} from 'test/nbrowser/testUtils';

describe('FormView', function() {
  this.timeout('90s');
  gu.bigScreen();

  let api: UserAPI;
  let docId: string;

  const cleanup = setupTestSuite();

  addToRepl('question', question);
  addToRepl('labels', readLabels);
  addToRepl('questionType', questionType);
  const clipboard = gu.getLockableClipboard();

  afterEach(() => gu.checkForErrors());

  async function createFormWith(type: string, more = false) {
    await gu.addNewSection('Form', 'Table1');

    // Make sure column D is not there.
    assert.isUndefined(await api.getTable(docId, 'Table1').then(t => t.D));

    // Add a text question
    await plusButton().click();
    if (more) {
      await clickMenu('More');
    }
    await clickMenu(type);
    await gu.waitForServer();

    // Make sure we see this new question (D).
    assert.deepEqual(await readLabels(), ['A', 'B', 'C', 'D']);

    await driver.find('.test-forms-publish').click();
    if (await driver.find('.test-modal-confirm').isPresent()) {
      await driver.find('.test-modal-confirm').click();
    }
    await gu.waitForServer();


    // Now open the form in external window.
    await clipboard.lockAndPerform(async (cb) => {
      const shareButton = await driver.find(`.test-forms-share`);
      await gu.scrollIntoView(shareButton);
      await shareButton.click();
      await gu.waitForServer();
      await driver.findWait('.test-forms-link', 1000).click();
      await gu.waitToPass(async () => assert.match(
        await driver.find('.test-tooltip').getText(), /Link copied to clipboard/), 1000);
      await driver.find('#clipboardText').click();
      await gu.selectAll();
      await cb.paste();
    });

    // Select it
    await question('D').click();

    return await driver.find('#clipboardText').value();
  }

  async function removeForm() {
    // Remove this section.
    await gu.openSectionMenu('viewLayout');
    await driver.find('.test-section-delete').click();
    await gu.waitForServer();

    // Remove record.
    await gu.sendActions([
      ['RemoveRecord', 'Table1', 1],
      ['RemoveColumn', 'Table1', 'D']
    ]);
  }

  async function waitForConfirm() {
    await gu.waitForServer();
    await gu.waitToPass(async () => {
      assert.isTrue(await driver.findWait('.test-form-container', 2000).isDisplayed());
      assert.equal(
        await driver.find('.test-form-success-text').getText(),
        'Thank you! Your response has been recorded.'
      );
    });
  }

  async function expectSingle(value: any) {
    assert.deepEqual(await api.getTable(docId, 'Table1').then(t => t.D), [value]);
  }

  async function expectInD(values: any[]) {
    assert.deepEqual(await api.getTable(docId, 'Table1').then(t => t.D), values);
  }

  describe('on personal site', async function() {
    before(async function() {
      const session = await gu.session().login();
      docId = await session.tempNewDoc(cleanup);
      api = session.createHomeApi();
    });

    gu.withClipboardTextArea();

    it('updates creator panel when navigated away', async function() {
      // Add 2 new pages.
      await gu.addNewPage('Form', 'New Table', {tableName: 'TabA'});
      await gu.renamePage('TabA');
      await gu.addNewPage('Form', 'New Table', {tableName: 'TabB'});

      // Open the creator panel on field tab
      await gu.openColumnPanel();

      // Select A column
      await question('A').click();

      // Make sure it is selected.
      assert.equal(await selectedLabel(), 'A');

      // And creator panel reflects it.
      assert.equal(await driver.find('.test-field-label').value(), "A");

      // Now switch to page TabA.
      await gu.openPage('TabA');

      // And select B column.
      await question('B').click();
      assert.equal(await selectedLabel(), 'B');

      // Make sure creator panel reflects it (it didn't).
      assert.equal(await driver.find('.test-field-label').value(), "B");

      await gu.undo(2); // There was a bug with second undo.
      await gu.undo();
    });

    it('triggers trigger formulas', async function() {
      const formUrl = await createFormWith('Text');
      // Add a trigger formula for this column.
      await gu.showRawData();
      await gu.getCell('D', 1).click();
      await gu.openColumnPanel();
      await driver.find(".test-field-set-trigger").click();
      await gu.waitAppFocus(false);
      await gu.sendKeys('"Hello from trigger"', Key.ENTER);
      await gu.waitForServer();
      await gu.closeRawTable();
      await gu.onNewTab(async () => {
        await driver.get(formUrl);
        await driver.findWait('input[type="submit"]', 2000).click();
        await waitForConfirm();
      });
      await expectSingle('Hello from trigger');
      await removeForm();
    });

    it('can submit a form with Text field', async function() {
      const formUrl = await createFormWith('Text');
      // We are in a new window.
      await gu.onNewTab(async () => {
        await driver.get(formUrl);
        await driver.findWait('input[name="D"]', 2000).click();
        await gu.sendKeys('Hello');
        assert.equal(await driver.find('input[name="D"]').value(), 'Hello');
        await driver.find('.test-form-reset').click();
        await driver.find('.test-modal-confirm').click();
        assert.equal(await driver.find('input[name="D"]').value(), '');
        await driver.find('input[name="D"]').click();
        await gu.sendKeys('Hello World');
        await driver.find('input[type="submit"]').click();
        await waitForConfirm();
      });
      // Make sure we see the new record.
      await expectSingle('Hello World');
      await removeForm();
    });

    it('can submit a form with Numeric field', async function() {
      const formUrl = await createFormWith('Numeric');
      // We are in a new window.
      await gu.onNewTab(async () => {
        await driver.get(formUrl);
        await driver.findWait('input[name="D"]', 2000).click();
        await gu.sendKeys('1983');
        assert.equal(await driver.find('input[name="D"]').value(), '1983');
        await driver.find('.test-form-reset').click();
        await driver.find('.test-modal-confirm').click();
        assert.equal(await driver.find('input[name="D"]').value(), '');
        await driver.find('input[name="D"]').click();
        await gu.sendKeys('1984');
        await driver.find('input[type="submit"]').click();
        await waitForConfirm();
      });
      // Make sure we see the new record.
      await expectSingle(1984);
      await removeForm();
    });

    it('can submit a form with Date field', async function() {
      const formUrl = await createFormWith('Date');
      // We are in a new window.
      await gu.onNewTab(async () => {
        await driver.get(formUrl);
        await driver.findWait('input[name="D"]', 2000).click();
        await gu.sendKeys('01011999');
        assert.equal(await driver.find('input[name="D"]').getAttribute('value'), '1999-01-01');
        await driver.find('.test-form-reset').click();
        await driver.find('.test-modal-confirm').click();
        assert.equal(await driver.find('input[name="D"]').getAttribute('value'), '');
        await driver.find('input[name="D"]').click();
        await gu.sendKeys('01012000');
        await driver.find('input[type="submit"]').click();
        await waitForConfirm();
      });
      // Make sure we see the new record.
      await expectSingle(/* 2000-01-01 */946684800);
      await removeForm();
    });

    it('can submit a form with Choice field', async function() {
      const formUrl = await createFormWith('Choice');
      // Add some options.
      await gu.openColumnPanel();

      await gu.choicesEditor.edit();
      await gu.choicesEditor.add('Foo');
      await gu.choicesEditor.add('Bar');
      await gu.choicesEditor.add('Baz');
      await gu.choicesEditor.save();
      await gu.toggleSidePanel('right', 'close');

      // We need to press view, as form is not saved yet.
      await gu.scrollActiveViewTop();
      await gu.waitToPass(async () => {
        assert.isTrue(await driver.find('.test-forms-view').isDisplayed());
      });
      // We are in a new window.
      await gu.onNewTab(async () => {
        await driver.get(formUrl);
        await driver.findWait('select[name="D"]', 2000);
        // Make sure options are there.
        assert.deepEqual(
          await driver.findAll('select[name="D"] option', e => e.getText()), ['Select...', 'Foo', 'Bar', 'Baz']
        );
        await driver.find('.test-form-search-select').click();
        assert.deepEqual(
          await driver.findAll('.test-sd-searchable-list-item', e => e.getText()), ['Select...', 'Foo', 'Bar', 'Baz']
        );
        await gu.sendKeys('Baz', Key.ENTER);
        assert.equal(await driver.find('select[name="D"]').value(), 'Baz');
        await driver.find('.test-form-reset').click();
        await driver.find('.test-modal-confirm').click();
        assert.equal(await driver.find('select[name="D"]').value(), '');
        await driver.find('.test-form-search-select').click();
        await driver.findContent('.test-sd-searchable-list-item', 'Bar').click();
        await driver.find('input[type="submit"]').click();
        await waitForConfirm();
      });
      await expectSingle('Bar');
      await removeForm();
    });

    it('can submit a form with Integer field', async function() {
      const formUrl = await createFormWith('Integer', true);
      // We are in a new window.
      await gu.onNewTab(async () => {
        await driver.get(formUrl);
        await driver.findWait('input[name="D"]', 2000).click();
        await gu.sendKeys('1983');
        assert.equal(await driver.find('input[name="D"]').value(), '1983');
        await driver.find('.test-form-reset').click();
        await driver.find('.test-modal-confirm').click();
        assert.equal(await driver.find('input[name="D"]').value(), '');
        await driver.find('input[name="D"]').click();
        await gu.sendKeys('1984');
        await driver.find('input[type="submit"]').click();
        await waitForConfirm();
      });
      // Make sure we see the new record.
      await expectSingle(1984);
      await removeForm();
    });

    it('can submit a form with Toggle field', async function() {
      const formUrl = await createFormWith('Toggle', true);
      // We are in a new window.
      await gu.onNewTab(async () => {
        await driver.get(formUrl);
        await driver.findWait('input[name="D"]', 2000).findClosest("label").click();
        assert.equal(await driver.find('input[name="D"]').getAttribute('checked'), 'true');
        await driver.find('.test-form-reset').click();
        await driver.find('.test-modal-confirm').click();
        assert.equal(await driver.find('input[name="D"]').getAttribute('checked'), null);
        await driver.find('input[name="D"]').findClosest("label").click();
        await driver.find('input[type="submit"]').click();
        await waitForConfirm();
      });
      await expectSingle(true);
      await gu.onNewTab(async () => {
        await driver.get(formUrl);
        await driver.findWait('input[type="submit"]', 2000).click();
        await waitForConfirm();
      });
      await expectInD([true, false]);

      // Remove the additional record added just now.
      await gu.sendActions([
        ['RemoveRecord', 'Table1', 2],
      ]);
      await removeForm();
    });

    it('can submit a form with ChoiceList field', async function() {
      const formUrl = await createFormWith('Choice List', true);
      // Add some options.
      await gu.openColumnPanel();

      await gu.choicesEditor.edit();
      await gu.choicesEditor.add('Foo');
      await gu.choicesEditor.add('Bar');
      await gu.choicesEditor.add('Baz');
      await gu.choicesEditor.save();
      await gu.toggleSidePanel('right', 'close');
      // We are in a new window.
      await gu.onNewTab(async () => {
        await driver.get(formUrl);
        await driver.findWait('input[name="D[]"][value="Bar"]', 2000).click();
        assert.equal(await driver.find('input[name="D[]"][value="Bar"]').getAttribute('checked'), 'true');
        await driver.find('.test-form-reset').click();
        await driver.find('.test-modal-confirm').click();
        assert.equal(await driver.find('input[name="D[]"][value="Bar"]').getAttribute('checked'), null);
        await driver.find('input[name="D[]"][value="Foo"]').click();
        await driver.find('input[name="D[]"][value="Baz"]').click();
        await driver.find('input[type="submit"]').click();
        await waitForConfirm();
      });
      await expectSingle(['L', 'Foo', 'Baz']);

      await removeForm();
    });

    it('can submit a form with Ref field', async function() {
      const formUrl = await createFormWith('Reference', true);
      // Add some options.
      await gu.openColumnPanel();
      await gu.setRefShowColumn('A');
      // Add 3 records to this table (it is now empty).
      await gu.sendActions([
        ['AddRecord', 'Table1', null, {A: 'Foo'}], // id 1
        ['AddRecord', 'Table1', null, {A: 'Bar'}], // id 2
        ['AddRecord', 'Table1', null, {A: 'Baz'}], // id 3
      ]);
      await gu.toggleSidePanel('right', 'close');
      // We are in a new window.
      await gu.onNewTab(async () => {
        await driver.get(formUrl);
        await driver.findWait('select[name="D"]', 2000);
        assert.deepEqual(
          await driver.findAll('select[name="D"] option', e => e.getText()),
          ['Select...', ...['Bar', 'Baz', 'Foo']]
        );
        assert.deepEqual(
          await driver.findAll('select[name="D"] option', e => e.value()),
          ['', ...['2', '3', '1']]
        );
        await driver.find('.test-form-search-select').click();
        assert.deepEqual(
          await driver.findAll('.test-sd-searchable-list-item', e => e.getText()), ['Select...', 'Bar', 'Baz', 'Foo']
        );
        await gu.sendKeys('Baz', Key.ENTER);
        assert.equal(await driver.find('select[name="D"]').value(), '3');
        await driver.find('.test-form-reset').click();
        await driver.find('.test-modal-confirm').click();
        assert.equal(await driver.find('select[name="D"]').value(), '');
        await driver.find('.test-form-search-select').click();
        await driver.findContent('.test-sd-searchable-list-item', 'Bar').click();
        await driver.find('input[type="submit"]').click();
        await waitForConfirm();
      });
      await expectInD([0, 0, 0, 2]);

      // Remove 3 records.
      await gu.sendActions([
        ['BulkRemoveRecord', 'Table1', [1, 2, 3, 4]],
      ]);

      await removeForm();
    });

    it('can submit a form with RefList field', async function() {
      const formUrl = await createFormWith('Reference List', true);
      // Add some options.
      await gu.openColumnPanel();

      await gu.setRefShowColumn('A');
      // Add 3 records to this table (it is now empty).
      await gu.sendActions([
        ['AddRecord', 'Table1', null, {A: 'Foo'}], // id 1
        ['AddRecord', 'Table1', null, {A: 'Bar'}], // id 2
        ['AddRecord', 'Table1', null, {A: 'Baz'}], // id 3
      ]);
      await gu.toggleSidePanel('right', 'close');
      // We are in a new window.
      await gu.onNewTab(async () => {
        await driver.get(formUrl);
        assert.equal(await driver.findWait('label:has(input[name="D[]"][value="1"])', 2000).getText(), 'Foo');
        assert.equal(await driver.find('label:has(input[name="D[]"][value="2"])').getText(), 'Bar');
        assert.equal(await driver.find('label:has(input[name="D[]"][value="3"])').getText(), 'Baz');
        await driver.find('input[name="D[]"][value="1"]').click();
        assert.equal(await driver.find('input[name="D[]"][value="1"]').getAttribute('checked'), 'true');
        await driver.find('.test-form-reset').click();
        await driver.find('.test-modal-confirm').click();
        assert.equal(await driver.find('input[name="D[]"][value="1"]').getAttribute('checked'), null);
        await driver.find('input[name="D[]"][value="1"]').click();
        await driver.find('input[name="D[]"][value="2"]').click();
        await driver.find('input[type="submit"]').click();
        await waitForConfirm();
      });
      await expectInD([null, null, null, ['L', 2, 1]]);

      // Remove 3 records.
      await gu.sendActions([
        ['BulkRemoveRecord', 'Table1', [1, 2, 3, 4]],
      ]);

      await removeForm();
    });

    it('excludes formula fields from forms', async function() {
      const formUrl = await createFormWith('Text');

      // Temporarily make A a formula column.
      await gu.sendActions([
        ['ModifyColumn', 'Table1', 'A', {formula: '"hello"', isFormula: true}],
      ]);

      // Check that A is hidden in the form editor.
      await gu.waitToPass(async () => assert.deepEqual(await readLabels(), ['B', 'C', 'D']));
      await gu.openWidgetPanel('widget');
      assert.deepEqual(
        await driver.findAll('.test-vfc-visible-field', (e) => e.getText()),
        ['B', 'C', 'D']
      );
      assert.deepEqual(
        await driver.findAll('.test-vfc-hidden-field', (e) => e.getText()),
        []
      );

      // Check that A is excluded from the published form.
      await gu.onNewTab(async () => {
        await driver.get(formUrl);
        await driver.findWait('input[name="D"]', 2000).click();
        await gu.sendKeys('Hello World');
        assert.isFalse(await driver.find('input[name="A"]').isPresent());
        await driver.find('input[type="submit"]').click();
        await waitForConfirm();
      });

      // Make sure we see the new record.
      await expectInD(['Hello World']);

      // And check that A was not modified.
      assert.deepEqual(await api.getTable(docId, 'Table1').then(t => t.A), ['hello']);

      // Revert A and check that it's visible again in the editor.
      await gu.sendActions([
        ['ModifyColumn', 'Table1', 'A', {formula: '', isFormula: false}],
      ]);
      await gu.waitToPass(async () => assert.deepEqual(await readLabels(), ['A', 'B', 'C', 'D']));
      assert.deepEqual(
        await driver.findAll('.test-vfc-visible-field', (e) => e.getText()),
        ['A', 'B', 'C', 'D']
      );
      assert.deepEqual(
        await driver.findAll('.test-vfc-hidden-field', (e) => e.getText()),
        []
      );

      await removeForm();
    });

    it('excludes attachment fields from forms', async function() {
      const formUrl = await createFormWith('Text');

      // Temporarily make A an attachments column.
      await gu.sendActions([
        ['ModifyColumn', 'Table1', 'A', {type: 'Attachments'}],
      ]);

      // Check that A is hidden in the form editor.
      await gu.waitToPass(async () => assert.deepEqual(await readLabels(), ['B', 'C', 'D']));
      await gu.openWidgetPanel('widget');
      assert.deepEqual(
        await driver.findAll('.test-vfc-visible-field', (e) => e.getText()),
        ['B', 'C', 'D']
      );
      assert.deepEqual(
        await driver.findAll('.test-vfc-hidden-field', (e) => e.getText()),
        []
      );

      // Check that A is excluded from the published form.
      await gu.onNewTab(async () => {
        await driver.get(formUrl);
        await driver.findWait('input[name="D"]', 2000).click();
        await gu.sendKeys('Hello World');
        assert.isFalse(await driver.find('input[name="A"]').isPresent());
        await driver.find('input[type="submit"]').click();
        await waitForConfirm();
      });

      // Make sure we see the new record.
      await expectInD(['Hello World']);

      // And check that A was not modified.
      assert.deepEqual(await api.getTable(docId, 'Table1').then(t => t.A), [null]);

      // Revert A and check that it's visible again in the editor.
      await gu.sendActions([
        ['ModifyColumn', 'Table1', 'A', {type: 'Text'}],
      ]);
      await gu.waitToPass(async () => assert.deepEqual(await readLabels(), ['A', 'B', 'C', 'D']));
      assert.deepEqual(
        await driver.findAll('.test-vfc-visible-field', (e) => e.getText()),
        ['A', 'B', 'C', 'D']
      );
      assert.deepEqual(
        await driver.findAll('.test-vfc-hidden-field', (e) => e.getText()),
        []
      );

      await removeForm();
    });

    it('can unpublish forms', async function() {
      const formUrl = await createFormWith('Text');
      await driver.find('.test-forms-unpublish').click();
      await driver.find('.test-modal-confirm').click();
      await gu.waitForServer();
      await gu.onNewTab(async () => {
        await driver.get(formUrl);
        assert.isTrue(await driver.findWait('.test-form-container', 2000).isDisplayed());
        assert.equal(
          await driver.find('.test-form-error-text').getText(),
          'Oops! This form is no longer published.'
        );
      });

      // Republish the form and check that the same URL works again.
      await driver.find('.test-forms-publish').click();
      await driver.find('.test-modal-confirm').click();
      await gu.waitForServer();
      await gu.onNewTab(async () => {
        await driver.get(formUrl);
        await driver.findWait('input[name="D"]', 2000);
      });
    });

    it('can stop showing warning when publishing or unpublishing', async function() {
      // Click "Don't show again" in both modals and confirm.
      await driver.find('.test-forms-unpublish').click();
      await driver.find('.test-modal-dont-show-again').click();
      await driver.find('.test-modal-confirm').click();
      await gu.waitForServer();
      await driver.find('.test-forms-publish').click();
      await driver.find('.test-modal-dont-show-again').click();
      await driver.find('.test-modal-confirm').click();
      await gu.waitForServer();

      // Check that the modals are no longer shown when publishing or unpublishing.
      await driver.find('.test-forms-unpublish').click();
      await gu.waitForServer();
      assert.isFalse(await driver.find('.test-modal-title').isPresent());
      await driver.find('.test-forms-publish').click();
      await gu.waitForServer();
      assert.isFalse(await driver.find('.test-modal-title').isPresent());
    });

    it('can create a form for a blank table', async function() {

      // Add new page and select form.
      await gu.addNewPage('Form', 'New Table', {
        tableName: 'Form'
      });

      // Make sure we see a form editor.
      assert.isTrue(await driver.find('.test-forms-editor').isDisplayed());

      // With 3 questions A, B, C.
      assert.deepEqual(await readLabels(), ['A', 'B', 'C']);

      // And a submit button.
      assert.isTrue(await driver.findContent('.test-forms-submit', gu.exactMatch('Submit')).isDisplayed());
    });

    it("doesn't generate fields when they are added", async function() {
      await gu.sendActions([
        ['AddVisibleColumn', 'Form', 'Choice',
          {type: 'Choice', widgetOption: JSON.stringify({choices: ['A', 'B', 'C']})}],
      ]);

      // Make sure we see a form editor.
      assert.isTrue(await driver.find('.test-forms-editor').isDisplayed());
      await driver.sleep(100);
      assert.isFalse(
        await driver.findContent('.test-forms-question-choice .test-forms-label', gu.exactMatch('Choice')).isPresent()
      );
    });

    it('supports basic drag and drop', async function() {

      // Make sure the order is right.
      assert.deepEqual(
        await readLabels(), ['A', 'B', 'C']
      );

      await driver.withActions(a =>
        a.move({origin: questionDrag('B')})
          .press()
          .move({origin: questionDrag('A')})
          .release()
      );

      await gu.waitForServer();

      // Make sure the order is right.
      assert.deepEqual(
        await readLabels(), ['B', 'A', 'C']
      );

      await driver.withActions(a =>
        a.move({origin: questionDrag('C')})
          .press()
          .move({origin: questionDrag('B')})
          .release()
      );

      await gu.waitForServer();

      // Make sure the order is right.
      assert.deepEqual(
        await readLabels(), ['C', 'B', 'A']
      );

      // Now move A on A and make sure nothing changes.
      await driver.withActions(a =>
        a.move({origin: questionDrag('A')})
          .press()
          .move({origin: questionDrag('A'), x: 50})
          .release()
      );

      await gu.waitForServer();
      assert.deepEqual(await readLabels(), ['C', 'B', 'A']);
    });

    it('can undo drag and drop', async function() {
      await gu.undo();
      assert.deepEqual(await readLabels(), ['B', 'A', 'C']);

      await gu.undo();
      assert.deepEqual(await readLabels(), ['A', 'B', 'C']);
    });

    it('adds new question at the end', async function() {
      // We should see single drop zone.
      assert.equal((await drops()).length, 1);

      // Move the A over there.
      await driver.withActions(a =>
        a.move({origin: questionDrag('A')})
          .press()
          .move({origin: plusButton().drag()})
          .release()
      );

      await gu.waitForServer();
      assert.deepEqual(await readLabels(), ['B', 'C', 'A']);
      await gu.undo();
      assert.deepEqual(await readLabels(), ['A', 'B', 'C']);

      // Now add a new question.
      await plusButton().click();

      await clickMenu('Text');
      await gu.waitForServer();

      // We should have new column D or type text.
      assert.deepEqual(await readLabels(), ['A', 'B', 'C', 'D']);
      assert.equal(await questionType('D'), 'Text');

      await gu.undo();
      assert.deepEqual(await readLabels(), ['A', 'B', 'C']);
    });

    it('adds question in the middle', async function() {
      await driver.withActions(a => a.contextClick(question('B')));
      await clickMenu('Insert question above');
      await gu.waitForServer();
      assert.deepEqual(await readLabels(), ['A', 'D', 'B', 'C']);

      // Now below C.
      await driver.withActions(a => a.contextClick(question('B')));
      await clickMenu('Insert question below');
      await gu.waitForServer();
      assert.deepEqual(await readLabels(), ['A', 'D', 'B', 'E', 'C']);

      // Make sure they are draggable.
      // Move D infront of C.
      await driver.withActions(a =>
        a.move({origin: questionDrag('D')})
          .press()
          .move({origin: questionDrag('C')})
          .release()
      );

      await gu.waitForServer();
      assert.deepEqual(await readLabels(), ['A', 'B', 'E', 'D', 'C']);

      // Remove 3 times.
      await gu.undo(3);
      assert.deepEqual(await readLabels(), ['A', 'B', 'C']);
    });

    it('selection works', async function() {

      // Click on A.
      await question('A').click();

      // Now A is selected.
      assert.equal(await selectedLabel(), 'A');

      // Click B.
      await question('B').click();

      // Now B is selected.
      assert.equal(await selectedLabel(), 'B');

      // Click on the edit button.
      await driver.find('.test-forms-submit').click();

      // Now nothing is selected.
      assert.isFalse(await isSelected(), 'Something is selected');

      // When we add new question, it is automatically selected.
      await plusButton().click();
      await clickMenu('Text');
      await gu.waitForServer();
      // Now D is selected.
      assert.equal(await selectedLabel(), 'D');

      await gu.undo();
      assert.deepEqual(await readLabels(), ['A', 'B', 'C']);
      await question('A').click();
    });

    it('hiding and revealing works', async function() {
      await gu.toggleSidePanel('left', 'close');
      await gu.openWidgetPanel();

      // We have only one hidden column.
      assert.deepEqual(await hiddenColumns(), ['Choice']);

      // Make sure we see it in the menu.
      await plusButton().click();

      // We have 1 unmapped menu item.
      assert.equal(await elementCount('menu-unmapped'), 1);

      // Now move it to the form on B
      await driver.withActions(a =>
        a.move({origin: hiddenColumn('Choice')})
          .press()
          .move({origin: questionDrag('B')})
          .release()
      );
      await gu.waitForServer();

      // It should be after A.
      await gu.waitToPass(async () => {
        assert.deepEqual(await readLabels(), ['A', 'Choice', 'B', 'C']);
      }, 500);

      // Undo to make sure it is bundled.
      await gu.undo();

      // It should be hidden again.
      assert.deepEqual(await hiddenColumns(), ['Choice']);
      assert.deepEqual(await readLabels(), ['A', 'B', 'C']);

      // And redo.
      await gu.redo();
      assert.deepEqual(await readLabels(), ['A', 'Choice', 'B', 'C']);
      assert.deepEqual(await hiddenColumns(), []);


      // Now hide it using menu.
      await question('Choice').rightClick();
      await clickMenu('Hide');
      await gu.waitForServer();

      // It should be hidden again.
      assert.deepEqual(await hiddenColumns(), ['Choice']);
      assert.deepEqual(await readLabels(), ['A', 'B', 'C']);

      // And undo.
      await gu.undo();
      assert.deepEqual(await readLabels(), ['A', 'Choice', 'B', 'C']);
      assert.deepEqual(await hiddenColumns(), []);

      // And redo.
      await gu.redo();
      assert.deepEqual(await readLabels(), ['A', 'B', 'C']);
      assert.deepEqual(await hiddenColumns(), ['Choice']);

      // Now unhide it using menu.
      await plusButton().click();
      await element('menu-unmapped').click();
      await gu.waitForServer();

      assert.deepEqual(await readLabels(), ['A', 'B', 'C', 'Choice']);
      assert.deepEqual(await hiddenColumns(), []);

      // Now hide it using Delete key.
      await driver.find('.test-forms-submit').click();
      await question('Choice').click();
      await gu.sendKeys(Key.DELETE);
      await gu.waitForServer();

      // It should be hidden again.
      assert.deepEqual(await hiddenColumns(), ['Choice']);
      assert.deepEqual(await readLabels(), ['A', 'B', 'C']);


      await gu.toggleSidePanel('right', 'close');
    });

    it('basic keyboard navigation works', async function() {
      await question('A').click();
      assert.equal(await selectedLabel(), 'A');

      // Move down.
      await arrow(Key.ARROW_DOWN);
      assert.equal(await selectedLabel(), 'B');

      // Move up.
      await arrow(Key.ARROW_UP);
      assert.equal(await selectedLabel(), 'A');

      // Move down to C.
      await arrow(Key.ARROW_DOWN, 2);
      assert.equal(await selectedLabel(), 'C');

      // Move down we should be at A (past the submit button, and titles and sections).
      await arrow(Key.ARROW_DOWN, 7);
      assert.equal(await selectedLabel(), 'A');

      // Do the same with Left and Right.
      await arrow(Key.ARROW_RIGHT);
      assert.equal(await selectedLabel(), 'B');
      await arrow(Key.ARROW_LEFT);
      assert.equal(await selectedLabel(), 'A');
      await arrow(Key.ARROW_RIGHT, 2);
      assert.equal(await selectedLabel(), 'C');
    });

    it('cutting works', async function() {
      const revert = await gu.begin();
      await question('A').click();
      // Send copy command.
      await clipboard.lockAndPerform(async (cb) => {
        await cb.cut();
        await gu.sendKeys(Key.ARROW_DOWN); // Focus on B.
        await gu.sendKeys(Key.ARROW_DOWN); // Focus on C.
        await cb.paste();
      });
      await gu.waitForServer();
      assert.deepEqual(await readLabels(), ['B', 'A', 'C']);
      await gu.undo();
      assert.deepEqual(await readLabels(), ['A', 'B', 'C']);

      // To the same for paragraph.
      await plusButton().click();
      await clickMenu('Paragraph');
      await gu.waitForServer();
      await element('Paragraph', 5).click();
      await clipboard.lockAndPerform(async (cb) => {
        await cb.cut();
        // Go over A and paste there.
        await gu.sendKeys(Key.ARROW_UP); // Focus on C.
        await gu.sendKeys(Key.ARROW_UP); // Focus on B.
        await gu.sendKeys(Key.ARROW_UP); // Focus on A.
        await cb.paste();
      });
      await gu.waitForServer();

      // Paragraph should be the first one now.
      assert.deepEqual(await readLabels(), ['A', 'B', 'C']);
      let elements = await driver.findAll('.test-forms-element');
      assert.isTrue(await elements[0].matches('.test-forms-Paragraph'));
      assert.isTrue(await elements[1].matches('.test-forms-Paragraph'));
      assert.isTrue(await elements[2].matches('.test-forms-Section'));
      assert.isTrue(await elements[3].matches('.test-forms-Paragraph'));
      assert.isTrue(await elements[4].matches('.test-forms-Paragraph'));
      assert.isTrue(await elements[5].matches('.test-forms-Paragraph'));

      // Put it back using undo.
      await gu.undo();
      elements = await driver.findAll('.test-forms-element');
      assert.isTrue(await elements[5].matches('.test-forms-Field'));
      // 0 - A, 1 - B, 2 - C, 3 - submit button.
      assert.isTrue(await elements[8].matches('.test-forms-Paragraph'));

      await revert();
    });

    const checkInitial = async () => assert.deepEqual(await readLabels(), ['A', 'B', 'C']);
    const checkNewCol = async () => {
      assert.equal(await selectedLabel(), 'D');
      assert.deepEqual(await readLabels(), ['A', 'B', 'C', 'D']);
      await gu.undo();
      await checkInitial();
    };
    const checkFieldsAtFirstLevel = (menuText: string) => {
      it(`can add ${menuText} elements from the menu`, async function() {
        await plusButton().click();
        await clickMenu(menuText);
        await gu.waitForServer();
        await checkNewCol();
      });
    };

    checkFieldsAtFirstLevel('Text');
    checkFieldsAtFirstLevel('Numeric');
    checkFieldsAtFirstLevel('Date');
    checkFieldsAtFirstLevel('Choice');

    const checkFieldInMore = (menuText: string) => {
      it(`can add ${menuText} elements from the menu`, async function() {
        await plusButton().click();
        await clickMenu('More');
        await clickMenu(menuText);
        await gu.waitForServer();
        await checkNewCol();
      });
    };

    checkFieldInMore('Integer');
    checkFieldInMore('Toggle');
    checkFieldInMore('DateTime');
    checkFieldInMore('Choice List');
    checkFieldInMore('Reference');
    checkFieldInMore('Reference List');

    const testStruct = (type: string, existing = 0) => {
      async function doTestStruct(menuLabel?: string) {
        assert.equal(await elementCount(type), existing);
        await plusButton().click();
        await clickMenu(menuLabel ?? type);
        await gu.waitForServer();
        assert.equal(await elementCount(type), existing + 1);
        await gu.undo();
        assert.equal(await elementCount(type), existing);
      }

      it(`can add structure ${type} element`, async function() {
        if (type === 'Section') {
          await doTestStruct('Insert section above');
          await doTestStruct('Insert section below');
        } else {
          await doTestStruct();
        }
      });
    };

    testStruct('Section', 1);
    testStruct('Columns');
    testStruct('Paragraph', 4);

    it('basic section', async function() {
      const revert = await gu.begin();

      assert.equal(await elementCount('Section'), 1);

      assert.deepEqual(await readLabels(), ['A', 'B', 'C']);

      // There is a drop in that section, click it to add a new question.
      await element('Section', 1).element('plus').click();
      await clickMenu('Text');
      await gu.waitForServer();

      assert.deepEqual(await readLabels(), ['A', 'B', 'C', 'D']);

      // And the question is inside a section.
      assert.equal(await element('Section', 1).element('label', 4).getText(), 'D');

      // Make sure we can move that question around.
      await driver.withActions(a =>
        a.move({origin: questionDrag('D')})
          .press()
          .move({origin: questionDrag('B')})
          .release()
      );

      await gu.waitForServer();
      assert.deepEqual(await readLabels(), ['A', 'D', 'B', 'C']);

      await gu.undo();
      assert.deepEqual(await readLabels(), ['A', 'B', 'C', 'D']);
      assert.equal(await element('Section', 1).element('label', 4).getText(), 'D');

      // Check that we can't delete a section if it's the only one.
      await element('Section').element('Paragraph', 1).click();
      await gu.sendKeys(Key.ESCAPE, Key.UP, Key.DELETE);
      await gu.waitForServer();
      assert.equal(await elementCount('Section'), 1);

      // Add a new section below it.
      await plusButton().click();
      await clickMenu('Insert section below');
      await gu.waitForServer();
      assert.equal(await elementCount('Section'), 2);
      await plusButton(element('Section', 2)).click();
      await clickMenu('Text');
      await gu.waitForServer();

      // Now check that we can delete the first section.
      await element('Section', 1).element('Paragraph', 1).click();
      await gu.sendKeys(Key.ESCAPE, Key.UP, Key.DELETE);
      await gu.waitForServer();
      assert.equal(await elementCount('Section'), 1);

      // Make sure that deleting the section also hides its fields and unmaps them.
      assert.deepEqual(await readLabels(), ['E']);
      await gu.openWidgetPanel();
      assert.deepEqual(await hiddenColumns(), ['A', 'B', 'C', 'Choice', 'D']);

      await gu.undo();
      assert.equal(await elementCount('Section'), 2);
      assert.deepEqual(await readLabels(), ['A', 'B', 'C', 'D', 'E']);
      assert.deepEqual(await hiddenColumns(), ['Choice']);

      await revert();
      assert.deepEqual(await readLabels(), ['A', 'B', 'C']);
    });

    it('basic columns work', async function() {
      const revert = await gu.begin();

      // Open the creator panel to make sure it works.
      await gu.openColumnPanel();

      await plusButton().click();
      await clickMenu('Columns');
      await gu.waitForServer();

      // We have two placeholders for free.
      assert.equal(await elementCount('Placeholder', element('Columns')), 2);

      // We can add another placeholder
      await element('add').click();
      await gu.waitForServer();

      // Now we have 3 placeholders.
      assert.equal(await elementCount('Placeholder', element('Columns')), 3);

      // We can click the middle one, and add a question.
      await element('Columns').element(`Placeholder`, 2).click();
      await clickMenu('Text');
      await gu.waitForServer();

      // Now we have 2 placeholders
      assert.equal(await elementCount('Placeholder', element('Columns')), 2);
      // And 4 questions.
      assert.deepEqual(await readLabels(), ['A', 'B', 'C', 'D']);

      // The question D is in the columns.
      assert.equal(await element('Columns').element('label').getText(), 'D');

      // We can move it around.
      await driver.withActions(a =>
        a.move({origin: questionDrag('D')})
          .press()
          .move({origin: questionDrag('B')})
          .release()
      );
      await gu.waitForServer();
      assert.deepEqual(await readLabels(), ['A', 'D', 'B', 'C']);

      // And move it back.
      await driver.withActions(a =>
        a.move({origin: questionDrag('D')})
          .press()
          .move({origin: element('Columns').element(`Placeholder`, 2).find(`.test-forms-drag`)})
          .release()
      );
      await gu.waitForServer();
      assert.deepEqual(await readLabels(), ['A', 'B', 'C', 'D']);


      assert.equal(await elementCount('column'), 3);
      assert.equal(await element('column', 1).type(), 'Placeholder');
      assert.equal(await element('column', 2).type(), 'Field');
      assert.equal(await element('column', 2).element('label').getText(), 'D');
      assert.equal(await element('column', 3).type(), 'Placeholder');

      // Check that we can remove the question.
      await question('D').rightClick();
      await clickMenu('Hide');
      await gu.waitForServer();

      // Now we have 3 placeholders.
      assert.equal(await elementCount('Placeholder', element('Columns')), 3);
      assert.deepEqual(await readLabels(), ['A', 'B', 'C']);

      // Undo and check it goes back at the right place.
      await gu.undo();
      assert.deepEqual(await readLabels(), ['A', 'B', 'C', 'D']);

      assert.equal(await elementCount('column'), 3);
      assert.equal(await element('column', 1).type(), 'Placeholder');
      assert.equal(await element('column', 2).type(), 'Field');
      assert.equal(await element('column', 2).element('label').getText(), 'D');
      assert.equal(await element('column', 3).type(), 'Placeholder');

      // Add a second question column.
      await element('Columns').element(`Placeholder`, 1).click();
      await clickMenu('Text');
      await gu.waitForServer();

      // Delete the column and make sure both questions get deleted.
      await element('Columns').element('Field', 1).click();
      await gu.sendKeys(Key.ESCAPE, Key.UP, Key.DELETE);
      await gu.waitForServer();
      assert.deepEqual(await readLabels(), ['A', 'B', 'C']);
      await gu.openWidgetPanel();
      assert.deepEqual(await hiddenColumns(), ['Choice', 'D', 'E']);

      // Undo and check everything reverted correctly.
      await gu.undo();
      assert.deepEqual(await readLabels(), ['A', 'B', 'C', 'E', 'D']);
      assert.equal(await elementCount('column'), 3);
      assert.equal(await element('column', 1).type(), 'Field');
      assert.equal(await element('column', 1).element('label').getText(), 'E');
      assert.equal(await element('column', 2).type(), 'Field');
      assert.equal(await element('column', 2).element('label').getText(), 'D');
      assert.equal(await element('column', 3).type(), 'Placeholder');
      assert.deepEqual(await hiddenColumns(), ['Choice']);
      await gu.undo();

      // There was a bug with paragraph and columns.
      // Add a paragraph to first placeholder.
      await element('Columns').element(`Placeholder`, 1).click();
      await clickMenu('Paragraph');
      await gu.waitForServer();

      // Now click this paragraph.
      await element('Columns').element(`Paragraph`, 1).click();
      // And make sure there aren't any errors.
      await gu.checkForErrors();

      await revert();
      assert.lengthOf(await driver.findAll('.test-forms-column'), 0);
      assert.deepEqual(await readLabels(), ['A', 'B', 'C']);
    });

    it('drags and drops on columns properly', async function() {
      const revert = await gu.begin();
      // Open the creator panel to make sure it works.
      await gu.openColumnPanel();

      await plusButton().click();
      await clickMenu('Columns');
      await gu.waitForServer();

      // Make sure that dragging columns on its placeholder doesn't do anything.
      await driver.withActions(a =>
        a.move({origin: element('Columns').element(`Placeholder`, 1).find(`.test-forms-drag`)})
          .press()
          .move({origin: element('Columns').element(`Placeholder`, 2).find(`.test-forms-drag`)})
          .release()
      );
      await gu.waitForServer();
      await gu.checkForErrors();

      // Make sure we see form correctly.
      const testNothingIsMoved = async () => {
        assert.deepEqual(await readLabels(), ['A', 'B', 'C']);
        assert.deepEqual(await elements(), [
          'Paragraph',
          'Paragraph',
          'Section',
          'Paragraph',
          'Paragraph',
          'Field',
          'Field',
          'Field',
          'Columns',
          'Placeholder',
          'Placeholder'
        ]);
      };

      await testNothingIsMoved();

      // Now do the same but move atop the + placeholder.
      await driver.withActions(a =>
        a.move({origin: element('Columns').element(`Placeholder`, 1).find(`.test-forms-drag`)})
          .press()
          .move({origin: driver.find('.test-forms-Columns .test-forms-add')})
          .release()
      );
      await gu.waitForServer();
      await gu.checkForErrors();
      await testNothingIsMoved();

      // Now move C column into first column.
      await driver.withActions(a =>
        a.move({origin: questionDrag('C')})
          .press()
          .move({origin: element('Columns').element(`Placeholder`, 1).find(`.test-forms-drag`)})
          .release()
      );
      await gu.waitForServer();
      await gu.checkForErrors();

      // Check that it worked.
      assert.equal(await element('column', 1).type(), 'Field');
      assert.equal(await element('column', 1).element('label').getText(), 'C');
      assert.equal(await element('column', 2).type(), 'Placeholder');

      // Try to move B over C.
      await driver.withActions(a =>
        a.move({origin: questionDrag('B')})
          .press()
          .move({origin: questionDrag('C')})
          .release()
      );
      await gu.waitForServer();
      await gu.checkForErrors();

      // Make sure it didn't work.
      assert.equal(await element('column', 1).type(), 'Field');
      assert.equal(await element('column', 1).element('label').getText(), 'C');

      // And B is still there.
      assert.equal(await element('Field', 2).element('label').getText(), 'B');

      // Now move B on the empty placholder.
      await driver.withActions(a =>
        a.move({origin: questionDrag('B')})
          .press()
          .move({origin: element('column', 2).drag()})
          .release()
      );
      await gu.waitForServer();
      await gu.checkForErrors();

      // Make sure it worked.
      assert.equal(await element('column', 1).type(), 'Field');
      assert.equal(await element('column', 1).element('label').getText(), 'C');
      assert.equal(await element('column', 2).type(), 'Field');
      assert.equal(await element('column', 2).element('label').getText(), 'B');

      // Now swap them moving C over B.
      await driver.withActions(a =>
        a.move({origin: questionDrag('C')})
          .press()
          .move({origin: questionDrag('B')})
          .release()
      );
      await gu.waitForServer();
      await gu.checkForErrors();
      assert.equal(await element('column', 1).element('label').getText(), 'B');
      assert.equal(await element('column', 2).element('label').getText(), 'C');

      // And swap them back.
      await driver.withActions(a =>
        a.move({origin: questionDrag('B')})
          .press()
          .move({origin: questionDrag('C')})
          .release()
      );
      await gu.waitForServer();
      await gu.checkForErrors();
      assert.equal(await element('column', 1).element('label').getText(), 'C');
      assert.equal(await element('column', 2).element('label').getText(), 'B');

      // Make sure we still have two columns only.
      assert.lengthOf(await driver.findAll('.test-forms-column'), 2);

      // Make sure draggin column on the add button doesn't add column.
      await driver.withActions(a =>
        a.move({origin: questionDrag('B')})
          .press()
          .move({origin: driver.find('.test-forms-Columns .test-forms-add')})
          .release()
      );
      await gu.waitForServer();
      await gu.checkForErrors();

      // Make sure we still have two columns only.
      assert.lengthOf(await driver.findAll('.test-forms-column'), 2);
      assert.equal(await element('column', 1).element('label').getText(), 'C');
      assert.equal(await element('column', 2).element('label').getText(), 'B');

      // Now move A over the + button to add a new column.
      await driver.withActions(a =>
        a.move({origin: questionDrag('A')})
          .press()
          .move({origin: driver.find('.test-forms-Columns .test-forms-add')})
          .release()
      );
      await gu.waitForServer();
      await gu.checkForErrors();
      assert.lengthOf(await driver.findAll('.test-forms-column'), 3);
      assert.equal(await element('column', 1).element('label').getText(), 'C');
      assert.equal(await element('column', 2).element('label').getText(), 'B');
      assert.equal(await element('column', 3).element('label').getText(), 'A');

      await revert();
    });

    it('changes type of a question', async function() {
      // Add text question as D column.
      await plusButton().click();
      await clickMenu('Text');
      await gu.waitForServer();
      assert.deepEqual(await readLabels(), ['A', 'B', 'C', 'D']);

      // Make sure it is a text question.
      assert.equal(await questionType('D'), 'Text');

      // Now change it to a choice, from the backend (as the UI is not clear here).
      await gu.sendActions([
        ['ModifyColumn', 'Form', 'D', {type: 'Choice', widgetOptions: JSON.stringify({choices: ['A', 'B', 'C']})}],
      ]);

      // Make sure it is a choice question.
      await gu.waitToPass(async () => {
        assert.equal(await questionType('D'), 'Choice');
      });

      // Now change it back to a text question.
      await gu.undo();
      await gu.waitToPass(async () => {
        assert.equal(await questionType('D'), 'Text');
      });

      await gu.redo();
      await gu.waitToPass(async () => {
        assert.equal(await questionType('D'), 'Choice');
      });

      await gu.undo(2);
      await gu.waitToPass(async () => {
        assert.deepEqual(await readLabels(), ['A', 'B', 'C']);
      });
    });
  });

  describe('on team site', async function() {
    before(async function() {
      const session = await gu.session().teamSite.login();
      docId = await session.tempNewDoc(cleanup);
      api = session.createHomeApi();
    });

    gu.withClipboardTextArea();

    it('can submit a form', async function() {
      // A bug was preventing this by forcing a login redirect from the public form URL.
      const formUrl = await createFormWith('Text');
      await gu.removeLogin();
      // We are in a new window.
      await gu.onNewTab(async () => {
        await driver.get(formUrl);
        await driver.findWait('input[name="D"]', 2000).click();
        await gu.sendKeys('Hello World');
        await driver.find('input[type="submit"]').click();
        await waitForConfirm();
      });
      // Make sure we see the new record.
      const session = await gu.session().teamSite.login();
      await session.loadDoc(`/doc/${docId}`);
      await expectSingle('Hello World');
      await removeForm();
    });
  });
});

function element(type: string, parent?: WebElement): ExtraElement;
function element(type: string, index: number, parent?: WebElement): ExtraElement;
function element(type: string, arg1?: number | WebElement, arg2?: WebElement): ExtraElement {
  if (typeof arg1 === 'number') {
    if (arg1 === 1) {
      return extra((arg2 ?? driver).find(`.test-forms-${type}`));
    }
    const nth = ((arg2 ?? driver).findAll(`.test-forms-${type}`).then(els => els[arg1 - 1])).then(el => {
      if (!el) { throw new Error(`No element of type ${type} at index ${arg1}`); }
      return el;
    });
    return extra(new WebElementPromise(driver, nth));
  } else {
    return extra((arg1 ?? driver).find(`.test-forms-${type}`));
  }
}

async function elementCount(type: string, parent?: WebElement) {
  return await (parent ?? driver).findAll(`.test-forms-${type}`).then(els => els.length);
}

async function readLabels() {
  return await driver.findAll('.test-forms-question .test-forms-label', el => el.getText());
}

function question(label: string) {
  return extra(driver.findContent(`.test-forms-label`, new RegExp('^' + escapeRegExp(label) + '\\*?$'))
                     .findClosest('.test-forms-editor'));
}

function questionDrag(label: string) {
  return question(label).find('.test-forms-drag');
}

function questionType(label: string) {
  return question(label).find('.test-forms-type').value();
}

function plusButton(parent?: WebElement) {
  return element('plus', parent);
}

function drops() {
  return driver.findAll('.test-forms-plus');
}

async function clickMenu(label: string) {
  // First try command as it will also contain the keyboard shortcut we need to discard.
  if (await driver.findContent('.grist-floating-menu li .test-cmd-name', gu.exactMatch(label)).isPresent()) {
    return driver.findContent('.grist-floating-menu li .test-cmd-name', gu.exactMatch(label)).click();
  }
  return driver.findContentWait('.grist-floating-menu li', gu.exactMatch(label), 100).click();
}

function isSelected() {
  return driver.findAll('.test-forms-field-editor-selected').then(els => els.length > 0);
}

function selected() {
  return driver.find('.test-forms-field-editor-selected');
}

function selectedLabel() {
  return selected().find('.test-forms-label-rendered').getText();
}

function hiddenColumns() {
  return driver.findAll('.test-vfc-hidden-field', e => e.getText());
}

function hiddenColumn(label: string) {
  return driver.findContent('.test-vfc-hidden-field', gu.exactMatch(label));
}

type ExtraElement = WebElementPromise & {
  rightClick: () => Promise<void>,
  element: (type: string, index?: number) => ExtraElement,
  /**
   * A draggable element inside. This is 2x2px div to help with drag and drop.
   */
  drag: () => WebElementPromise,
  type: () => Promise<string>,
};

function extra(el: WebElementPromise): ExtraElement {
  const webElement: any = el;

  webElement.rightClick = async function() {
    await driver.withActions(a => a.contextClick(el));
  };

  webElement.element = function(type: string, index?: number) {
    return element(type, index ?? 1, el);
  };

  webElement.drag = function() {
    return el.find('.test-forms-drag');
  };
  webElement.type = async function() {
    return await el.getAttribute('data-box-model');
  };

  return webElement;
}

async function arrow(key: string, times: number = 1) {
  for (let i = 0; i < times; i++) {
    await gu.sendKeys(key);
  }
}

async function elements() {
  return await driver.findAll('.test-forms-element', el => el.getAttribute('data-box-model'));
}
