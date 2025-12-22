import { addToRepl, assert, driver, stackWrapFunc } from 'mocha-webdriver';
import * as gu from 'test/nbrowser/gristUtils';
import { server, setupTestSuite } from 'test/nbrowser/testUtils';


describe('VisibleFieldsConfig', function() {
  this.timeout(20000);
  setupTestSuite();
  addToRepl('findField', findField);

  function findField(state: 'visible'|'hidden', content: RegExp) {
    return driver.findContent(`.test-vfc-${state}-fields .kf_draggable`, content);
  }

  async function isSelected(state: 'visible'|'hidden', content: RegExp): Promise<boolean> {
    return Boolean(await findField(state, content).find('input').getAttribute('checked'));
  }


  it('should support hiding/revealing a column with single click', async function() {
    // create new document
    await server.simulateLogin("Chimpy", "chimpy@getgrist.com", "nasa");
    const docId = await gu.createNewDoc('Chimpy', 'nasa', 'Horizon', 'VisibleFieldsConfig_test');
    await gu.loadDoc(`/o/nasa/doc/${docId}`);

    // check 'A', 'B', 'C' are visible
    assert.deepEqual(await driver.findAll('.g-column-label', e => e.getText()), ['A', 'B', 'C']);

    // open right panel
    await gu.toggleSidePanel('right', 'open');

    // hide 'A'
    await findField('visible', /A/).mouseMove().find('.test-vfc-hide').click();
    await gu.waitForServer();

    // check 'B', 'C' are visible
    assert.deepEqual(await driver.findAll('.g-column-label', e => e.getText()), ['B', 'C']);

    // reveal 'A'
    await findField('hidden', /A/).mouseMove().find('.test-vfc-hide').click();
    await gu.waitForServer();

    // check 'B', 'C', 'A' are visible
    assert.deepEqual(await driver.findAll('.g-column-label', e => e.getText()), ['B', 'C', 'A']);

  });

  it('hiding should work even when the hidden fields are collapsed', async function() {
    // collapse hidden fields
    await driver.find('.test-vfc-collapse-hidden').click();

    // hide 'A'
    await findField('visible', /A/).mouseMove().find('.test-vfc-hide').click();
    await gu.waitForServer();

    // uncollapse hidden fields
    await driver.find('.test-vfc-collapse-hidden').click();

    // check 'A' is listed as hidden
    assert.deepEqual(
      await driver.findAll(`.test-vfc-hidden-fields .kf_draggable`, e => e.getText()),
        ['A']
      );

    // check 'A' is hidden
    assert.deepEqual(await driver.findAll('.g-column-label', e => e.getText()), ['B', 'C']);

    // undo
    await gu.undo();
  });

  it('should support reordering with drag and drop', async function() {

    // Drag 'B' below 'C'
    await driver.withActions(actions => (
      actions
        .move({origin: findField('visible', /B/)})
        .move({origin: findField('visible', /B/).find('.test-dragger')})
        .press()
        .move({origin: findField('visible', /C/), y: 1})
        .release()
    ));
    await gu.waitForServer();

    // check 'C', 'B', 'A' are visible
    assert.deepEqual(await driver.findAll('.g-column-label', e => e.getText()), ['C', 'B', 'A']);
  });


  it('should allow to hide multiple columns', async function() {

    // check that initally 'Hide ...' and 'Clear' buttons are hidden
    assert.equal(await driver.find('.test-vfc-visible-batch-buttons').isPresent(), false);

    // select 'A'
    await findField('visible', /A/).find('input').click();

    // check that buttons are visible
    assert.equal(await driver.find('.test-vfc-visible-batch-buttons').isPresent(), true);

    // un-select 'A'
    await findField('visible', /A/).find('input').click();

    // check that buttons are hidden
    assert.equal(await driver.find('.test-vfc-visible-batch-buttons').isPresent(), false);

    // select All
    await driver.find('.test-vfc-visible-fields-select-all').click();

    // check that buttons are visible
    assert.equal(await driver.find('.test-vfc-visible-batch-buttons').isPresent(), true);

    // click 'Clear'
    await driver.find('.test-vfc-visible-batch-buttons').findContent('button', /Clear/).click();

    // check that buttons are hidden
    assert.equal(await driver.find('.test-vfc-visible-batch-buttons').isPresent(), false);

    // select All and unselect 'A'
    await driver.find('.test-vfc-visible-fields-select-all').click();
    await findField('visible', /A/).find('input').click();

    // click 'Hide  ...' button
    await driver.find('.test-vfc-visible-batch-buttons').findContent('button', /Hide/).click();

    // wait for server and check that 'A' is visible
    await gu.waitForServer();
    assert.deepEqual(await driver.findAll('.g-column-label', e => e.getText()), ['A']);
  });

  it('should allow to \'Show\' multiple column', async function() {

    // check that buttons are not present
    assert.equal(await driver.find('.test-vfc-hidden-batch-buttons').isPresent(), false);

    // select 'B', 'C'
    await findField('hidden', /B/).find('input').click();
    await findField('hidden', /C/).find('input').click();

    // check that buttons are visible
    assert.equal(await driver.find('.test-vfc-hidden-batch-buttons').isPresent(), true);

    // click 'Show  ...' button and check that 'A', 'B', 'C' are visible
    await driver.find('.test-vfc-hidden-batch-buttons').findContent('button', /Show/).click();
    await gu.waitForServer();
    assert.deepEqual(await driver.findAll('.g-column-label', e => e.getText()), ['A', 'B', 'C']);

    // check that buttons are not present
    assert.equal(await driver.find('.test-vfc-hidden-batch-buttons').isPresent(), false);
  });

  it('hidden fields should not lose selection when a field is hidden', async function() {
    // This test makes sure the state survives a dom rebuild, which does happens when hiding a field

    // hide 'B'
    await findField('visible', /B/).mouseMove().find('.test-vfc-hide').click();
    await gu.waitForServer();

    // select 'B'
    await findField('hidden', /B/).find('input').click();

    // check 'B' is selected
    assert.equal(await isSelected('hidden', /B/), true);

    // hide 'A'
    await findField('visible', /A/).mouseMove().find('.test-vfc-hide').click();
    await gu.waitForServer();

    // check 'B' is still selected
    assert.equal(await isSelected('hidden', /B/), true);

    await gu.undo();
    await gu.undo();
  });

  it('should be disabled while editing a card layout', async function() {
    const checkDisabled = async (disabled: boolean) => {
      try {
        await findField('visible', /A/).find('input').click();
      } catch (e) {
        if (!disabled) {
          throw e;
        }
      }
      assert.equal(await isSelected('visible', /A/), !disabled);
      assert.equal(await driver.find('.test-vfc-visible-batch-buttons').isPresent(), !disabled);
      try {
        await findField('hidden', /B/).find('input').click();
      } catch (e) {
        if (!disabled) {
          throw e;
        }
      }
      assert.equal(await isSelected('hidden', /B/), !disabled);
      assert.equal(await driver.find('.test-vfc-hidden-batch-buttons').isPresent(), !disabled);
    };

    await gu.addNewSection('Card', 'Table1');
    await findField('visible', /B/).mouseMove().find('.test-vfc-hide').click();
    await gu.waitForServer();

    await driver.find('.test-vconfigtab-detail-edit-layout').click();
    await checkDisabled(true);
    assert.isNotNull(await findField('visible', /A/).mouseMove().find('.test-vfc-hide').getAttribute('disabled'));
    assert.isNotNull(await findField('hidden', /B/).mouseMove().find('.test-vfc-hide').getAttribute('disabled'));

    await driver.findContent('.test-edit-layout-controls button', 'Cancel').click();
    await checkDisabled(false);
    await findField('visible', /A/).mouseMove().find('.test-vfc-hide').click();
    await gu.waitForServer();
    assert.deepEqual(
      await driver.findAll(`.test-vfc-visible-fields .kf_draggable`, e => e.getText()),
        ['C']
      );
    await findField('hidden', /B/).mouseMove().find('.test-vfc-hide').click();
    await gu.waitForServer();
    assert.deepEqual(
      await driver.findAll(`.test-vfc-hidden-fields .kf_draggable`, e => e.getText()),
        ['A']
      );

    await gu.undo(4);
  });

  describe('multi selection', () => {

    // tests multi selection for both the list of visible fields and the list of hidden fields.

    describe('visible fields', function() {
      stackWrapFunc(testMultiSelection)('visible');
    });


    describe('hidden fields', function() {

      it('initialize test', async function() {
        // testMultiSelection expects all fields to be in the draggable under test, so we need to
        // hide all fields.
        await driver.find(`.test-vfc-visible-fields-select-all`).click();
        await driver.find('.test-vfc-visible-batch-buttons').findContent('button', /Hide/).click();
        await gu.waitForServer();

        // check all fields are present in the hidden draggable
        assert.deepEqual(
          await driver.findAll(`.test-vfc-hidden-fields .kf_draggable`, e => e.getText()),
          ['A', 'B', 'C']
        );
      });

      stackWrapFunc(testMultiSelection)('hidden');
    });

  });


  function testMultiSelection(state: 'hidden'|'visible') {

    function findButtons() {
      return driver.find(`.test-vfc-${state}-batch-buttons`);
    }

    function isFieldSelected(field: RegExp) {
      return isSelected(state, field);
    }

    function toggle(field: RegExp) {
      return findField(state, field).find('input').click();
    }

    async function applyBatchAction() {
      const content = state === 'hidden' ? /Show/ : /Hide/;
      await driver.find(`.test-vfc-${state}-batch-buttons`).findContent('button', content).click();
      await gu.waitForServer();
    }

    it('\'Select All\'should work correctly', async function() {
      // check 'A', 'B', 'C' are present
      assert.deepEqual(
        await driver.findAll(`.test-vfc-${state}-fields .kf_draggable`, e => e.getText()),
        ['A', 'B', 'C']
      );

      // click select All
      await driver.find(`.test-vfc-${state}-fields-select-all`).click();

      // check all checkbox are selected
      assert.equal(await isFieldSelected(/A/), true);
      assert.equal(await isFieldSelected(/B/), true);
      assert.equal(await isFieldSelected(/C/), true);

      // check buttons are present
      assert.equal(await findButtons().isPresent(), true);

      // apply action
      await applyBatchAction();

      // check 'A', 'B', 'C' are not present
      assert.deepEqual(
        await driver.findAll(`.test-vfc-${state}-fields .kf_draggable`, e => e.getText()),
        []
      );

      // check button are hidden
      assert.equal(await findButtons().isPresent(), false);

      // undo
      await gu.undo();
    });

    it('\'Clear\' should work correctly', async function() {
      // select 'A', 'B'
      await toggle(/A/);
      await toggle(/B/);

      // check 'A', 'B' is selected
      assert.equal(await isFieldSelected(/A/), true);
      assert.equal(await isFieldSelected(/B/), true);

      // click Clear
      await driver.find(`.test-vfc-${state}-batch-buttons`).findContent('button', /Clear/).click();

      // check 'A', 'B' is not selected
      assert.equal(await isFieldSelected(/A/), false);
      assert.equal(await isFieldSelected(/B/), false);
    });

    it('Buttons should show only when some are checked', async function() {
      // check button are not present,w
      assert.equal(await findButtons().isPresent(), false);

      // Select 'A'
      await toggle(/A/);

      // check buttons are present
      assert.equal(await findButtons().isPresent(), true);

      // Select 'B', unselect 'A'
      await toggle(/A/);
      await toggle(/B/);

      // check buttons are still present
      assert.equal(await findButtons().isPresent(), true);

      // Hide 'B'
      await findField(state, /B/).mouseMove().find('.test-vfc-hide').click();
      await gu.waitForServer();

      // check buttons are not present,
      assert.equal(await findButtons().isPresent(), false);

      // select 'A'
      await toggle(/A/);

      // apply batch action
      await applyBatchAction();

      // check buttons are not present
      assert.equal(await findButtons().isPresent(), false);

      // undo, undo
      await gu.undo();
      await gu.undo();

      // select 'A', hide by clicking the icon and check button are not present
      await toggle(/A/);
      await findField(state, /A/).mouseMove().find('.test-vfc-hide').click();
      await gu.waitForServer();
      assert.equal(await findButtons().isPresent(), false);
      await gu.undo();

      // select A and hide it by clicking redo, and check button are not present
      await toggle(/A/);
      await gu.redo();
      assert.equal(await findButtons().isPresent(), false);
      await gu.undo();
    });

    it('\'Select All\' should not be visible when the list is empty', async function() {
      // click select All
      await driver.find(`.test-vfc-${state}-fields-select-all`).click();

      // apply batch action
      await applyBatchAction();

      // check that select all is not present
      assert.equal(
        await driver.find(`.test-vfc-${state}-fields-select-all`).isPresent(),
        false
      );

      // undo
      await gu.undo();
    });
  }

});
