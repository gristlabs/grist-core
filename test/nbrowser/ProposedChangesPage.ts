import {assert, driver} from 'mocha-webdriver';
import * as gu from 'test/nbrowser/gristUtils';
import {setupTestSuite} from 'test/nbrowser/testUtils';

describe('ProposedChangesPage', function() {
  this.timeout(60000);
  const cleanup = setupTestSuite();

  // Currently this page exists only on a document where accepting
  // proposals is turned on. The flag for turning this on is, in turn, hidden
  // behind an experimental flag.
  it('can be enabled experimentally for a document', async function() {
    const session = await gu.session().teamSite.login();
    await session.tempDoc(cleanup, 'Hello.grist');
    await driver.find('.test-tools-settings').click();

    // Add the experimental flag to the URL.
    const url = await driver.getCurrentUrl();
    await driver.get(url + '?experiment=proposedChangesPage');
    // Confirm the flag.
    await driver.findWait('.test-modal-confirm', 2000).click();
    // Confirm we want to reload.
    await driver.findWait('.test-modal-confirm', 2000).click();

    // Check the accepting proposals checkbox is now visible.
    assert.match(
      await driver.findWait('#admin-panel-item-description-acceptProposals', 2000).getText(),
      /Allow others to propose changes/);
    // But it shouldn't be checked yet.
    assert.equal(
      await driver.find('input.test-settings-accept-proposals').getAttribute('checked'),
      null
    );
    // Now check it.
    await driver.find('input.test-settings-accept-proposals').click();
    // A new page should appear in the toolbox.
    await driver.findWait('.test-tools-proposals', 2000);
    // The flag should be checked now.
    assert.equal(
      await driver.find('input.test-settings-accept-proposals').getAttribute('checked'),
      'true'
    );
  });

  it('can make and apply a simple proposed change', async function() {
    // Load a test document.
    const session = await gu.session().teamSite.login();
    const doc = await session.tempDoc(cleanup, 'Hello.grist');

    // Turn on feature.
    const api = session.createHomeApi();
    await api.updateDoc(doc.id, {
      options: {
        proposedChanges: {
          acceptProposals: true
        }
      }
    });

    // Put something known in the first cell.
    await gu.getCell('A', 1).click();
    await gu.waitAppFocus();
    await gu.enterCell('test1');

    // Work on a copy.
    await driver.find('.test-tb-share').click();
    await driver.findWait('.test-work-on-copy', 2000).click();
    await gu.waitForServer();

    // Change the content of the first cell.
    await gu.getCell('A', 1).click();
    await gu.waitAppFocus();
    await gu.enterCell('test2');

    // Go to the propose-changes page.
    assert.equal(await driver.find('.test-tools-proposals').getText(),
                 'Propose Changes');
    await driver.find('.test-tools-proposals').click();

    // Make sure the expected change is shown.
    await driver.findContentWait('.test-main-content', /Propose Changes/, 2000);
    await driver.findWait('.action_log_table', 2000);
    assert.lengthOf(await driver.findAll('.action_log_table'), 1);
    assert.equal(
      await driver.find('.action_log_table tr:first-of-type').getText(),
      'A E'
    );
    assert.equal(
      await driver.find('.action_log_table tr:nth-of-type(2)').getText(),
      '→\ntest1test2\nTEST1TEST2'
    );

    // Check that expanding context works (at least, that it does something).
    assert.equal(await driver.find('.action_log_table button').getText(), '>');
    await driver.find('.action_log_table button').click();
    assert.equal(await driver.find('.action_log_table button').getText(), '<');
    assert.equal(
      await driver.findContentWait('.action_log_table tr:first-of-type', /id/, 2000).getText(),
      'id A B C D E'
    );
    assert.equal(
      await driver.find('.action_log_table tr:nth-of-type(2)').getText(),
      '→ 1\ntest1test2\nTEST1TEST2'
    );

    // Check a "Propose" button is present, and click it.
    assert.match(await driver.find('.test-proposals-propose').getText(), /Propose/);
    await driver.find('.test-proposals-propose').click();

    // Once proposed, there should be a status line, and the same
    // button should now be labelled "Update".
    await driver.findContentWait('.test-proposals-status', /Proposed/, 2000);
    assert.match(await driver.find('.test-proposals-propose').getText(), /Update/);

    // Try retracting the proposal. The status should become "retracted"
    // and the proposal button should be back to its original state.
    await driver.findWait('.test-proposals-retract', 2000).click();
    await driver.findContentWait('.test-proposals-status', /Retracted/, 2000);
    assert.match(await driver.find('.test-proposals-propose').getText(), /Propose/);
    await driver.find('.test-proposals-propose').click();
    await driver.findContentWait('.test-proposals-status', /Proposed/, 2000);

    // Click on the "original document" to see how things are there now.
    await driver.findContentWait('span', /original document/, 2000).click();

    // The wording on the changes page is slightly different now (Proposed
    // Changes versus Propose Changes)
    assert.match(
      await driver.findContentWait('.test-proposals-header', /# 1/, 2000).getText(),
      /Proposed/
    );

    // There should be exactly one proposal.
    assert.lengthOf(await driver.findAll('.test-proposals-header'), 1);

    // The proposal should basically be to change something to "test2".
    // Click on that part.
    await driver.findContent('span.action_log_cell_add', /test2/).click();

    // It should bring us to a cell that is currently at "test1".
    await driver.findContentWait('.test-widget-title-text', /TABLE1/, 2000);
    assert.equal(await gu.getCell({rowNum: 1, col: 0}).getText(), 'test1');

    // Go back to the changes page, and click "Apply".
    assert.equal(await driver.find('.test-tools-proposals').getText(),
                 'Proposed Changes');
    await driver.find('.test-tools-proposals').click();
    await driver.findWait('.test-proposals-apply', 2000).click();
    await gu.waitForServer();

    // Now go back and see the cell is now filled with "test2".
    await driver.findContent('span.action_log_cell_add', /test2/).click();
    await driver.findContentWait('.test-widget-title-text', /TABLE1/, 2000);
    assert.equal(await gu.getCell({rowNum: 1, col: 0}).getText(), 'test2');

    // Note that a formula column error is tickled by this test. This
    // needs to be dealt with.
  });

  it('can make and apply multiple proposed changes', async function() {
    // Load a test document.
    const session = await gu.session().teamSite.login();
    const doc = await session.tempDoc(cleanup, 'Hello.grist');

    // Turn on feature.
    const api = session.createHomeApi();
    await api.updateDoc(doc.id, {
      options: {
        proposedChanges: {
          acceptProposals: true
        }
      }
    });
    await api.applyUserActions(doc.id, [
      ['AddTable', 'Life', [{id: 'A', type: 'Int'}, {id: 'B', type: 'Text'}]],
      ['AddRecord', 'Life', 1, {A: 10, B: 'Fish'}],
      ['AddRecord', 'Life', 2, {A: 20, B: 'Primate'}],
    ]);

    await gu.openPage('Life');
    const url = await driver.getCurrentUrl();

    // Work on a copy.
    async function workOnCopy() {
      await driver.findWait('.test-tb-share', 2000).click();
      await driver.findWait('.test-work-on-copy', 2000).click();
      await gu.waitForServer();
      await gu.openPage('Life');
    }
    await workOnCopy();

    // Make a change.
    await gu.getCell('B', 1).click();
    await gu.waitAppFocus();
    await gu.enterCell('Bird');

    // Propose the change.
    async function proposeChange() {
      assert.equal(await driver.find('.test-tools-proposals').getText(),
                   'Propose Changes');
      await driver.find('.test-tools-proposals').click();
      await driver.findWait('.test-proposals-propose', 2000).click();
    }
    await proposeChange();

    // Work on another copy and propose a different change.
    await driver.get(url);
    await workOnCopy();
    await gu.getCell('B', 2).click();
    await gu.waitAppFocus();
    await gu.enterCell('Mammal');
    await proposeChange();

    // Work on another copy and propose a different change.
    await driver.get(url);
    await workOnCopy();
    await gu.getCell('B', 3).click();
    await gu.waitAppFocus();
    await gu.enterCell('SpaceDuck');
    await proposeChange();

    // Click on the "original document" to see how things are there now.
    await driver.findContentWait('span', /original document/, 2000).click();

    // There should be exactly three proposals, newest first.
    await driver.findWait('.test-proposals-header', 2000);
    assert.lengthOf(await driver.findAll('.test-proposals-header'), 3);
    assert.deepEqual(
      await driver.findAll('span.action_log_cell_add', e => e.getText()),
      [ 'SpaceDuck', 'Mammal', 'Bird' ]
    );

    // Apply the second one and check that it has an effect.
    assert.deepEqual((await api.getDocAPI(doc.id).getRows('Life')).B,
                     [ 'Fish', 'Primate' ]);
    await (await driver.findAll('.test-proposals-apply')).at(1)?.click();
    await gu.waitForServer();
    assert.match(
      await driver.findContent('.test-proposals-header', /# 2/).getText(),
      /Applied/
    );
    assert.deepEqual((await api.getDocAPI(doc.id).getRows('Life')).B,
                     [ 'Fish', 'Mammal' ]);

    // Now the third one.
    await (await driver.findAll('.test-proposals-apply')).at(2)?.click();
    await gu.waitForServer();
    assert.match(
      await driver.findContent('.test-proposals-header', /# 1/).getText(),
      /Applied/
    );
    assert.deepEqual((await api.getDocAPI(doc.id).getRows('Life')).B,
                     [ 'Bird', 'Mammal' ]);

    // Now the first one.
    await (await driver.findAll('.test-proposals-apply')).at(0)?.click();
    await gu.waitForServer();
    assert.match(
      await driver.findContent('.test-proposals-header', /# 3/).getText(),
      /Applied/
    );
    assert.deepEqual((await api.getDocAPI(doc.id).getRows('Life')).B,
                     [ 'Bird', 'Mammal', 'SpaceDuck' ]);
  });
});
