import {assert, driver} from 'mocha-webdriver';
import * as gu from 'test/nbrowser/gristUtils';
import {setupTestSuite} from 'test/nbrowser/testUtils';

describe('ProposedChangesPage', function() {
  this.timeout(60000);
  const cleanup = setupTestSuite();

  // Currently this page exists only on a document where accepting
  // proposals is turned on.
  it('can be enabled for a document', async function() {
    const session = await gu.session().teamSite.login();
    await session.tempDoc(cleanup, 'Hello.grist');
    await driver.find('.test-tools-settings').click();

    // Check the accepting proposals checkbox is visible.
    assert.match(
      await driver.findWait('#admin-panel-item-description-acceptProposals', 2000).getText(),
      /Allow others to suggest changes/);
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
    await gu.waitForDocToLoad();

    // Change the content of the first cell.
    await gu.getCell('A', 1).click();
    await gu.waitAppFocus();
    await gu.enterCell('test2');

    // Go to the propose-changes page.
    assert.equal(await driver.find('.test-tools-proposals').getText(),
                 'Suggest Changes');
    await driver.find('.test-tools-proposals').click();

    // Make sure the expected change is shown.
    await driver.findContentWait('.test-main-content', /Suggest Changes/, 2000);
    await driver.findWait('.test-actionlog-tabular-diffs .field_clip', 2000);
    assert.deepEqual(await getColumns('TABLE1'), ['A', 'E']);
    assert.deepEqual(await getRowValues('TABLE1', 0), ['test1test2', 'TEST1TEST2']);
    assert.deepEqual(await getChangeType('TABLE1', 0), '→');

    // Check that expanding context works (at least, that it does something).
    await expand('TABLE1');
    await driver.findWait('.test-actionlog-tabular-diffs .field_clip', 2000);
    assert.deepEqual(await getColumns('TABLE1'), ['id', 'A', 'B', 'C', 'D', 'E']);
    assert.deepEqual(await getRowValues('TABLE1', 0), ['1', 'test1test2', "", "", "", 'TEST1TEST2']);
    assert.deepEqual(await getChangeType('TABLE1', 0), '→');

    await collapse('TABLE1');
    await driver.findWait('.test-actionlog-tabular-diffs .field_clip', 2000);
    assert.deepEqual(await getColumns('TABLE1'), ['A', 'E']);
    assert.deepEqual(await getRowValues('TABLE1', 0), ['test1test2', 'TEST1TEST2']);
    assert.deepEqual(await getChangeType('TABLE1', 0), '→');

    // Check a "Suggest" button is present, and click it.
    assert.match(await driver.find('.test-proposals-propose').getText(), /Suggest/);
    await driver.find('.test-proposals-propose').click();

    // Once proposed, there should be a status line, and the "Suggest"
    // button should be absent.
    await driver.findContentWait('.test-proposals-status', /Suggestion/, 2000);
    assert.equal(await driver.find('.test-proposals-propose').isPresent(), false);

    // Try retracting the proposal. The status should become "retracted"
    // and the proposal button should be back to its original state.
    await driver.findWait('.test-proposals-retract', 2000).click();
    await driver.findContentWait('.test-proposals-status', /Retracted/, 2000);
    assert.match(await driver.find('.test-proposals-propose').getText(), /Suggest/);
    await driver.find('.test-proposals-propose').click();
    await driver.findContentWait('.test-proposals-status', /Suggest/, 2000);

    // Click on the "original document" to see how things are there now.
    await driver.findContentWait('span', /original document/, 2000).click();

    // The wording on the changes page is slightly different now (Proposed
    // Changes versus Propose Changes)
    assert.match(
      await driver.findContentWait('.test-proposals-header', /#1/, 2000).getText(),
      /Suggestion/
    );

    // There should be exactly one proposal.
    assert.lengthOf(await driver.findAll('.test-proposals-header'), 1);

    // The proposal should basically be to change something to "test2".
    // Click on that part.
    await gu.dbClick(driver.findContent('.diff-remote', /test2/));

    // It should bring us to a cell that is currently at "test1".
    await driver.findContentWait('.test-widget-title-text', /TABLE1/, 2000);
    assert.equal(await gu.getCell({rowNum: 1, col: 0}).getText(), 'test1');

    // Go back to the changes page, and click "Accept".
    assert.equal(await driver.find('.test-tools-proposals').getText(),
                 'Suggestions');
    await driver.find('.test-tools-proposals').click();
    await driver.findWait('.test-proposals-apply', 2000).click();
    await gu.waitForServer();

    // Now go back and see the cell is now filled with "test2".
    await gu.dbClick(driver.findContent('.diff-remote', /test2/));
    await driver.findContentWait('.test-widget-title-text', /TABLE1/, 2000);
    assert.equal(await gu.getCell({rowNum: 1, col: 0}).getText(), 'test2');

    // Note that a formula column error is tickled by this test. This
    // needs to be dealt with.
  });

  it('can make and apply multiple proposed changes', async function() {
    const {doc, api} = await makeLifeDoc();
    const url = await driver.getCurrentUrl();

    await workOnCopy(url);

    // Make a change.
    await gu.getCell('B', 1).click();
    await gu.waitAppFocus();
    await gu.enterCell('Bird');

    await proposeChange();

    // Work on another copy and propose a different change.
    await workOnCopy(url);
    await gu.getCell('B', 2).click();
    await gu.waitAppFocus();
    await gu.enterCell('Mammal');
    await proposeChange();

    // Work on another copy and propose a different change.
    await workOnCopy(url);
    await gu.getCell('B', 3).click();
    await gu.waitAppFocus();
    await gu.enterCell('SpaceDuck');
    await proposeChange();

    // Click on the "original document" to see how things are there now.
    await driver.findContentWait('span', /original document/, 2000).click();

    // There should be exactly three proposals, newest first.
    await driver.findWait('.test-proposals-header', 2000);
    assert.lengthOf(await driver.findAll('.test-proposals-header'), 3);
    await driver.findWait('.diff-remote', 2000);
    assert.deepEqual(
      await driver.findAll('.diff-remote', e => e.getText()),
      [ 'SpaceDuck', 'Mammal', 'Bird' ]
    );

    // Apply the second one and check that it has an effect.
    assert.deepEqual((await api.getDocAPI(doc.id).getRows('Life')).B,
                     [ 'Fish', 'Primate' ]);
    await driver.find('.test-proposals-patch:nth-child(2)')
      .find('.test-proposals-apply').click();
    await gu.waitForServer();
    assert.match(
      await driver.findContent('.test-proposals-header', /#2/).getText(),
      /Accepted/
    );
    assert.deepEqual((await api.getDocAPI(doc.id).getRows('Life')).B,
                     [ 'Fish', 'Mammal' ]);

    // Now the third one.
    await driver.find('.test-proposals-patch:nth-child(3)')
      .find('.test-proposals-apply').click();
    await gu.waitForServer();
    assert.match(
      await driver.findContent('.test-proposals-header', /#1/).getText(),
      /Accepted/
    );
    assert.deepEqual((await api.getDocAPI(doc.id).getRows('Life')).B,
                     [ 'Bird', 'Mammal' ]);

    // Now the first one.
    await driver.find('.test-proposals-patch:nth-child(1)')
      .find('.test-proposals-apply').click();
    await gu.waitForServer();
    assert.match(
      await driver.findContent('.test-proposals-header', /#3/).getText(),
      /Accepted/
    );
    assert.deepEqual((await api.getDocAPI(doc.id).getRows('Life')).B,
                     [ 'Bird', 'Mammal', 'SpaceDuck' ]);
  });

  it('can apply a proposed change after a trunk change', async function() {
    const {api, doc} = await makeLifeDoc();
    const url = await driver.getCurrentUrl();

    await workOnCopy(url);

    // Make a change.
    await gu.getCell('B', 1).click();
    await gu.waitAppFocus();
    await gu.enterCell('Bird');

    await proposeChange();

    // Click on the "original document".
    await driver.findContentWait('span', /original document/, 2000).click();

    // There should be exactly one proposal.
    await driver.findWait('.test-proposals-header', 2000);
    assert.lengthOf(await driver.findAll('.test-proposals-header'), 1);

    // Make sure the expected change is shown.
    await driver.findWait('.test-actionlog-tabular-diffs .field_clip', 2000);
    assert.deepEqual(await getColumns('LIFE'), ['B']);
    assert.deepEqual(await getRowValues('LIFE', 0), ['FishBird']);
    assert.deepEqual(await getChangeType('LIFE', 0), '→');

    // Change column and table name.
    await api.applyUserActions(doc.id, [
      ['RenameColumn', 'Life', 'B', 'BB'],
    ]);
    await api.applyUserActions(doc.id, [
      ['RenameTable', 'Life', 'Vie'],
    ]);
    await driver.sleep(500);
    // Check that expanding context works (at least, that it does something).
    await expand('LIFE');
    await driver.findWait('.test-actionlog-tabular-diffs .field_clip', 2000);
    assert.deepEqual(await getColumns('VIE'), ['id', 'A', 'BB']);
    assert.deepEqual(await getRowValues('VIE', 0), ['1', '10', 'FishBird']);
    assert.deepEqual(await getChangeType('VIE', 0), '→');

    // Apply and check that it has an effect.
    assert.deepEqual((await api.getDocAPI(doc.id).getRows('Vie')).BB,
                     [ 'Fish', 'Primate' ]);
    await driver.find('.test-proposals-patch')
      .find('.test-proposals-apply').click();
    await gu.waitForServer();
    assert.match(
      await driver.findContent('.test-proposals-header', /#1/).getText(),
      /Accepted/
    );
    assert.deepEqual((await api.getDocAPI(doc.id).getRows('Vie')).BB,
                     [ 'Bird', 'Primate' ]);
  });

  async function makeLifeDoc() {
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
    return {session, doc, api};
  }

  // Work on a copy.
  async function workOnCopy(url: string) {
    await driver.get(url);
    if (await gu.isAlertShown()) { await gu.acceptAlert(); }
    await gu.waitForDocToLoad();
    await driver.findWait('.test-tb-share', 2000).click();
    await driver.findWait('.test-work-on-copy', 2000).click();
    await gu.waitForServer();
    await gu.openPage('Life');
  }

  // Propose a change.
  async function proposeChange() {
    assert.equal(await driver.find('.test-tools-proposals').getText(),
                 'Suggest Changes');
    await driver.find('.test-tools-proposals').click();
    await driver.findWait('.test-proposals-propose', 2000).click();
    await gu.waitForServer();
  }
});

async function getColumns(section: string): Promise<string[]> {
  const title = await driver.findContentWait('.test-viewsection-title', section, 2000);
  const parent = await title.findClosest('.viewsection_content');
  return await parent.findAll('.test-column-title-text', e => e.getText());
}

async function getRowValues(section: string, rowIndex: number): Promise<string[]> {
  const title = await driver.findContentWait('.test-viewsection-title', section, 2000);
  const parent = await title.findClosest('.viewsection_content');
  await parent.findWait('.record', 2000);
  const row = (await parent.findAll('.gridview_row .record'))[rowIndex];
  return await row.findAll('.field_clip', e => e.getText());
}

async function getChangeType(section: string, rowIndex: number): Promise<string> {
  const title = await driver.findContentWait('.test-viewsection-title', section, 2000);
  const parent = await title.findClosest('.viewsection_content');
  await parent.findWait('.gridview_data_row_num', 2000);
  const row = (await parent.findAll('.gridview_data_row_num'))[rowIndex];
  return await row.getText();
}

async function expand(section: string) {
  const title = await driver.findContentWait('.test-viewsection-title', section, 2000);
  const parent = await title.findClosest('.viewsection_content');
  const button = await parent.find('.test-proposals-expand');
  await button.click();
}

async function collapse(section: string) {
  const title = await driver.findContentWait('.test-viewsection-title', section, 2000);
  const parent = await title.findClosest('.viewsection_content');
  const button = await parent.find('.test-proposals-collapse');
  await button.click();
}
