import {DocCreationInfo} from 'app/common/DocListAPI';
import {UserAPI} from 'app/common/UserAPI';
import {assert, driver, Key} from 'mocha-webdriver';
import {Session} from 'test/nbrowser/gristUtils';
import * as gu from 'test/nbrowser/gristUtils';
import {server, setupTestSuite} from 'test/nbrowser/testUtils';
import values = require('lodash/values');

describe('Pages', function() {
  this.timeout(60000);
  let doc: DocCreationInfo;
  let api: UserAPI;
  let session: Session;
  const cleanup = setupTestSuite({team: true});

  before(async () => {
    session = await gu.session().teamSite.login();
    doc = await session.tempDoc(cleanup, 'Pages.grist');
    api = session.createHomeApi();
  });

  it('should show censor pages', async () => {
    // Make a 3 level hierarchy.
    assert.deepEqual(await gu.getPageTree(), [
      {
        label: 'Interactions', children: [
          { label: 'Documents' },
        ]
      },
      {
        label: 'People', children: [
          { label: 'User & Leads' },
          { label: 'Overview' },
        ]
      },
    ]);
    await insertPage(/Overview/, /User & Leads/);
    assert.deepEqual(await gu.getPageTree(), [
      {
        label: 'Interactions', children: [
          { label: 'Documents' },
        ]
      },
      {
        label: 'People', children: [
          { label: 'User & Leads', children: [{ label: 'Overview' }] },
        ]
      },
    ]);
    const revertAcl = await gu.beginAclTran(api, doc.id);
    // Update ACL, hide People table from all users.
    await hideTable("People");
    // We will be reloaded, but it's not easy to wait for it, so do the refresh manually.
    await gu.reloadDoc();
    assert.deepEqual(await gu.getPageTree(), [
      {
        label: 'Interactions', children: [
          { label: 'Documents'},
        ]
      },
      {
        label: 'CENSORED', children: [
          { label: 'User & Leads', children: [{ label: 'Overview' }] },
        ]
      },
    ]);

    // Test that we can't click this page.
    await driver.findContent('.test-treeview-itemHeader', /CENSORED/).click();
    await gu.waitForServer();
    assert.equal(await gu.getSectionTitle(), 'INTERACTIONS');

    // Test that we don't have move handler.
    assert.isFalse(
      await driver.findContent('.test-treeview-itemHeaderWrapper', /CENSORED/)
                  .find('.test-treeview-handle').isPresent()
    );

    // Now hide User_Leads
    await hideTable("User_Leads");
    await gu.reloadDoc();
    assert.deepEqual(await gu.getPageTree(), [
      {
        label: 'Interactions', children: [
          { label: 'Documents'},
        ]
      },
      {
        label: 'CENSORED', children: [
          { label: 'CENSORED', children: [{ label: 'Overview' }] },
        ]
      },
    ]);

    // Now hide Overview, and test that whole node is hidden.
    await hideTable("Overview");
    await gu.reloadDoc();
    assert.deepEqual(await gu.getPageTree(), [
      {
        label: 'Interactions', children: [
          { label: 'Documents'},
        ]
      }
    ]);

    // Now hide Documents, this is a leaf, so it should be hidden from the start
    await hideTable("Documents");
    await gu.reloadDoc();
    assert.deepEqual(await gu.getPageTree(), [
      {
        label: 'Interactions'
      }
    ]);

    // Now hide Interactions, we should have a blank treeview
    await hideTable("Interactions");
    // We can wait for doc to load, because it waits for section.
    await driver.findWait(".test-treeview-container", 1000);
    assert.deepEqual(await gu.getPageTree(), []);

    // Rollback
    await revertAcl();
    await gu.reloadDoc();
    assert.deepEqual(await gu.getPageTree(), [
      {
        label: 'Interactions', children: [
          { label: 'Documents' },
        ]
      },
      {
        label: 'People', children: [
          { label: 'User & Leads', children: [{ label: 'Overview' }] },
        ]
      },
    ]);
    await gu.undo();
  });


  it('should list all pages in document', async () => {

    // check content of _girst_Pages and _grist_Views
    assert.deepInclude(await api.getTable(doc.id, '_grist_Pages'), {
      viewRef: [1, 2, 3, 4, 5],
      pagePos: [1, 2, 1.5, 3, 4],
      indentation: [0, 0, 1, 1, 1],
    });
    assert.deepInclude(await api.getTable(doc.id, '_grist_Views'), {
      name: ['Interactions', 'People', 'Documents', 'User & Leads', 'Overview'],
      id: [1, 2, 3, 4, 5],
    });

    // load page and check all pages are listed
    await driver.get(`${server.getHost()}/o/test-grist/doc/${doc.id}`);
    await driver.findWait('.test-treeview-container', 1000);
    assert.deepEqual(await gu.getPageNames(), ['Interactions', 'Documents', 'People', 'User & Leads', 'Overview']);
  });

  it('should select correct page if /p/<docPage> in the url', async () => {

    // show page with viewRef 2
    await gu.loadDoc(`/o/test-grist/doc/${doc.id}/p/2`);
    assert.deepEqual(await gu.getPageNames(), ['Interactions', 'Documents', 'People', 'User & Leads', 'Overview']);
    assert.match(await driver.find('.test-treeview-itemHeader.selected').getText(), /People/);
    assert.match(await gu.getActiveSectionTitle(), /People/i);
  });

  it('should select first page if /p/<docPage> is omitted in the url', async () => {

    await driver.get(`${server.getHost()}/o/test-grist/doc/${doc.id}`);
    await driver.findWait('.test-treeview-container', 1000);
    assert.match(await driver.find('.test-treeview-itemHeader').getText(), /Interactions/);
    assert.match(await driver.find('.test-treeview-itemHeader.selected').getText(), /Interactions/);
    assert.match(await gu.getActiveSectionTitle(), /Interactions/i);

    // Check also that this did NOT cause a redirect to include /p/ in the URL.
    assert.notMatch(await driver.getCurrentUrl(), /\/p\//);
  });

  it('clicking page should set /p/<docPage> in the url', async () => {
    await driver.get(`${server.getHost()}/o/test-grist/doc/${doc.id}`);

    // Wait for data to load.
    assert.equal(await driver.findWait('.viewsection_title', 3000).isDisplayed(), true);
    await gu.waitForServer();

    // Click on a page; check the URL, selected item, and the title of the view section.
    await gu.openPage(/Documents/);
    assert.match(await driver.getCurrentUrl(), /\/p\/3/);
    assert.match(await driver.find('.test-treeview-itemHeader.selected').getText(), /Documents/);
    assert.match(await gu.getActiveSectionTitle(), /Documents/i);

    // Click on another page; check the URL, selected item, and the title of the view section.
    await gu.openPage(/People/);
    assert.match(await driver.getCurrentUrl(), /\/p\/2/);
    assert.match(await driver.find('.test-treeview-itemHeader.selected').getText(), /People/);
    assert.match(await gu.getActiveSectionTitle(), /People/i);

    // TODO: Add a check that open-in-new-tab works too.
  });

  it('should allow renaming table', async () => {

    // open dots menu and click rename
    await gu.openPageMenu('People');
    await driver.find('.test-docpage-rename').doClick();

    // do rename
    await driver.find('.test-docpage-editor').sendKeys('PeopleRenamed', Key.ENTER);
    await gu.waitForServer();

    assert.deepEqual(
      await gu.getPageNames(),
      ['Interactions', 'Documents', 'PeopleRenamed', 'User & Leads', 'Overview']
    );

    // Test that we can delete after remove (there was a bug related to this).
    await gu.removePage('PeopleRenamed');

    assert.deepEqual(await gu.getPageNames(), ['Interactions', 'Documents', 'User & Leads', 'Overview']);

    // revert changes
    await gu.undo(2);
    assert.deepEqual(await gu.getPageNames(), ['Interactions', 'Documents', 'People', 'User & Leads', 'Overview']);
  });

  it('should allow renaming table when click on page selected label', async () => {
    // do rename
    await gu.openPage(/People/);
    await driver.findContent('.test-treeview-label', 'People').doClick();
    await driver.find('.test-docpage-editor').sendKeys('PeopleRenamed', Key.ENTER);
    await gu.waitForServer();

    assert.deepEqual(
      await gu.getPageNames(),
      ['Interactions', 'Documents', 'PeopleRenamed', 'User & Leads', 'Overview']
    );

    // revert changes
    await gu.undo(2);
    assert.deepEqual(await gu.getPageNames(), ['Interactions', 'Documents', 'People', 'User & Leads', 'Overview']);
  });

  it('should not allow blank page name', async () => {
    // Begin renaming of People page
    await gu.openPageMenu('People');
    await driver.find('.test-docpage-rename').doClick();

    // Delete page name and check editor's value equals ''
    await driver.find('.test-docpage-editor').sendKeys(Key.DELETE);
    assert.equal(await driver.find('.test-docpage-editor').value(), '');

    // Save blank name
    await driver.sendKeys(Key.ENTER);
    await gu.waitForServer();

    // Check name is still People
    assert.include(await gu.getPageNames(), 'People');
  });

  it('should pull out emoji from page names', async () => {
    // A regular character is used as an initial AND kept in the name.
    assert.deepEqual(await getInitialAndName(/People/), ['P', 'People']);

    // It looks like our version of Chromedriver does not support sending emojis using sendKeys
    // (issue mentioned here https://stackoverflow.com/a/59139690), so we'll use executeScript to
    // rename pages.
    async function renamePage(origName: string|RegExp, newName: string) {
      await gu.openPageMenu(origName);
      await driver.find('.test-docpage-rename').doClick();
      const editor = await driver.find('.test-docpage-editor');
      await driver.executeScript((el: HTMLInputElement, text: string) => { el.value = text; }, editor, newName);
      await editor.sendKeys(Key.ENTER);
      await gu.waitForServer();
    }

    async function getInitialAndName(pageName: string|RegExp): Promise<[string, string]> {
      return await driver.findContent('.test-treeview-itemHeader', pageName)
      .findAll('.test-docpage-initial, .test-docpage-label', el => el.getText()) as [string,
        string];
    }

    // An emoji is pulled into the initial, and is removed from the name.
    await renamePage('People', '👥 People');

    assert.deepEqual(await getInitialAndName(/People/), ['👥', 'People']);

    // Two complex emojis -- the first one is the pulled-out initial.
    await renamePage('People', '👨‍👩‍👧‍👦👨‍👩‍👧Guest List');
    assert.deepEqual(await getInitialAndName(/Guest List/),
      ['👨‍👩‍👧‍👦', '👨‍👩‍👧Guest List']);

    // Digits should not be considered emoji (even though they match /\p{Emoji}/...)
    await renamePage(/Guest List/, '5Guest List');
    assert.deepEqual(await getInitialAndName(/Guest List/), ['5', '5Guest List']);

    await gu.undo(3);
    assert.deepEqual(await getInitialAndName(/People/), ['P', 'People']);
  });

  it('should show tooltip for long page names on hover', async () => {
    await gu.openPageMenu('People');
    await driver.find('.test-docpage-rename').doClick();
    await driver.find('.test-docpage-editor')
      .sendKeys('People, Persons, Humans, Ladies & Gentlemen', Key.ENTER);
    await gu.waitForServer();

    await driver.findContent('.test-treeview-label', /People, Persons, Humans, Ladies & Gentlemen/).mouseMove();
    await driver.wait(() => driver.findWait('.test-tooltip', 1000).isDisplayed(), 3000);
    assert.equal(await driver.find('.test-tooltip').getText(),
      'People, Persons, Humans, Ladies & Gentlemen');

    await gu.undo();
    assert.deepEqual(await gu.getPageNames(), ['Interactions', 'Documents', 'People', 'User & Leads', 'Overview']);

    await driver.findContent('.test-treeview-label', /People/).mouseMove();
    await driver.sleep(500);
    assert.equal(await driver.find('.test-tooltip').isPresent(), false);
  });

  it('should not change page when clicking the input while renaming page', async () => {
    // check that initially People is selected
    assert.match(await driver.find('.test-treeview-itemHeader.selected').getText(), /People/);

    // start renaming Documents and click the input
    await gu.openPageMenu('Documents');
    await driver.find('.test-docpage-rename').doClick();
    await driver.find('.test-docpage-editor').click();

    // check that People is still the selected page.
    assert.match(await driver.find('.test-treeview-itemHeader.selected').getText(), /People/);

    // abord renaming
    await driver.find('.test-docpage-editor').sendKeys(Key.ESCAPE);
  });

  it('should allow moving pages', async () => {

    // check initial state
    assert.deepEqual(await gu.getPageNames(), ['Interactions', 'Documents', 'People', 'User & Leads', 'Overview']);

    // move page
    await movePage(/User & Leads/, {after: /Overview/});
    await gu.waitForServer();

    assert.deepEqual(await gu.getPageNames(), ['Interactions', 'Documents', 'People', 'Overview', 'User & Leads']);

    // revert changes
    await gu.undo();
    assert.deepEqual(await gu.getPageNames(), ['Interactions', 'Documents', 'People', 'User & Leads', 'Overview']);

  });

  it('moving a page should not extend collapsed page', async () => {
    /**
     * Here what is really being tested is that TreeModelRecord correctly reuses TreeModelItem,
     * because if it wasn't the case, TreeViewComponent would not be able to reuse dom and would
     * rebuild dom for all pages causing all page to be expanded.
     */

    // let's collapse Interactions
    await driver.findContent('.test-treeview-itemHeader', /Interactions/).find('.test-treeview-itemArrow').doClick();
    assert.deepEqual(await gu.getPageNames(), ['Interactions', '', 'People', 'User & Leads', 'Overview']);

    // let's move
    await movePage(/User & Leads/, {after: /Overview/});
    await gu.waitForServer();

    // check that pages has moved and Interactions remained collapsed
    assert.deepEqual(await gu.getPageNames(), ['Interactions', '', 'People', 'Overview', 'User & Leads']);

    // revert changes
    await gu.undo();
    await driver.findContent('.test-treeview-itemHeader', /Interactions/).find('.test-treeview-itemArrow').doClick();
    assert.deepEqual(await gu.getPageNames(), ['Interactions', 'Documents', 'People', 'User & Leads', 'Overview']);
  });

  it('should allow to cycle though pages using shortcuts', async () => {

    function nextPage() {
      return driver.find('body').sendKeys(Key.chord(Key.ALT, Key.DOWN));
    }

    function prevPage() {
      return driver.find('body').sendKeys(Key.chord(Key.ALT, Key.UP));
    }

    function selectedPage() {
      return driver.find('.test-treeview-itemHeader.selected').getText();
    }

    // goto page 'Interactions'
    await gu.openPage(/Interactions/);

    // check selected page
    assert.match(await selectedPage(), /Interactions/);

    // prev page
    await prevPage();

    // check selecte page
    assert.match(await selectedPage(), /Overview/);

    // prev page
    await prevPage();

    // check selecte page
    assert.match(await selectedPage(), /User & Leads/);

    // next page
    await nextPage();

    // check selected page
    assert.match(await selectedPage(), /Overview/);


    // next page
    await nextPage();

    // check selected page
    assert.match(await selectedPage(), /Interactions/);

  });

  it('undo/redo should update url', async () => {

    // goto page 'Interactions' and send keys
    await gu.openPage(/Interactions/);
    assert.match(await driver.find('.test-treeview-itemHeader.selected').getText(), /Interactions/);
    await driver.findContentWait('.gridview_data_row_num', /1/, 2000);
    await driver.sendKeys(Key.ENTER, 'Foo', Key.ENTER);
    await gu.waitForServer();
    assert.deepEqual(await gu.getVisibleGridCells(0, [1]), ['Foo']);

    // goto page 'People' and click undo
    await gu.openPage(/People/);
    await gu.waitForDocToLoad();
    await gu.waitForUrl(/\/p\/2\b/); // check that url match p/2

    await gu.undo();
    await gu.waitForDocToLoad();
    await gu.waitForUrl(/\/p\/1\b/); // check that url match p/1

    // check that "Interactions" page is selected
    assert.match(await driver.find('.test-treeview-itemHeader.selected').getText(), /Interactions/);

    // check that undo worked
    assert.deepEqual(await gu.getVisibleGridCells(0, [1]), ['']);

    // Click on next test should not trigger renaming input
    await driver.findContent('.test-treeview-itemHeader', /People/).doClick();
  });

  it('Add new page should update url', async () => {
    // goto page 'Interactions'  and check that url updated
    await gu.openPage(/Interactions/);
    await gu.waitForUrl(/\/p\/1\b/);

    // Add new Page, check that url updated and page is selected
    await gu.addNewPage(/Table/, /New Table/);
    await gu.waitForUrl(/\/p\/6\b/);
    assert.match(await driver.find('.test-treeview-itemHeader.selected').getText(), /Table1/);

    // goto page 'Interactions' and check that url updated and page selectd
    await gu.openPage(/Interactions/);
    await gu.waitForUrl(/\/p\/1\b/);
    assert.match(await driver.find('.test-treeview-itemHeader.selected').getText(), /Interactions/);
  });

  it('Removing a page should work', async () => {

    // Create and open new document
    const docId = await session.tempNewDoc(cleanup, "test-page-removal");
    await driver.get(`${server.getHost()}/o/test-grist/doc/${docId}`);
    await gu.waitForUrl('test-page-removal');

    // Add a new page using Table1
    await gu.addNewPage(/Table/, /Table1/);
    assert.deepInclude(await api.getTable(docId, '_grist_Tables'), {
      tableId: ['Table1'],
      primaryViewId: [1],
    });
    assert.deepInclude(await api.getTable(docId, '_grist_Views'), {
      name: ['Table1', 'New page'],
      id: [1, 2],
    });
    assert.deepEqual(await gu.getPageNames(), ['Table1', 'New page']);

    // check that the new page is now selected
    await gu.waitForUrl(/\/p\/2\b/);
    assert.match(await driver.find('.test-treeview-itemHeader.selected').getText(), /New page/);

    // remove new page
    await gu.removePage(/New page/);

    // check that url has no p/<...> and 'Table1' is now selected
    await driver.wait(async () => !/\/p\//.test(await driver.getCurrentUrl()), 2000);
    assert.match(await driver.find('.test-treeview-itemHeader.selected').getText(), /Table1/);

    // check that corresponding view is removed
    assert.deepInclude(await api.getTable(docId, '_grist_Tables'), {
      tableId: ['Table1'],
      primaryViewId: [1],
    });
    assert.deepInclude(await api.getTable(docId, '_grist_Views'), {
      name: ['Table1'],
      id: [1],
    });
    assert.deepEqual(await gu.getPageNames(), ['Table1']);

    // create table Foo and 1 new page using Foo
    await api.applyUserActions(docId, [['AddTable', 'Foo', [{id: null, isFormula: true}]]]);
    await driver.findContentWait('.test-treeview-itemHeader', /Foo/, 2000);
    await gu.addNewPage(/Table/, /Foo/);
    assert.deepInclude(await api.getTable(docId, '_grist_Tables'), {
      tableId: ['Table1', 'Foo'],
      primaryViewId: [1, 2],
    });
    assert.deepInclude(await api.getTable(docId, '_grist_Views'), {
      name: ['Table1', 'Foo', 'New page'],
      id: [1, 2, 3],
    });
    assert.deepEqual(await gu.getPageNames(), ['Table1', 'Foo', 'New page']);

    // check that last page is now selected
    await gu.waitForUrl(/\/p\/3\b/);
    assert.match(await driver.find('.test-treeview-itemHeader.selected').getText(), /New page/);

    // remove table and make sure pages are also removed.
    await gu.removeTable('Foo');

    // check that Foo and page are removed
    assert.deepInclude(await api.getTable(docId, '_grist_Tables'), {
      tableId: ['Table1'],
      primaryViewId: [1],
    });
    assert.deepInclude(await api.getTable(docId, '_grist_Views'), {
      name: ['Table1'],
      id: [1],
    });
    assert.deepEqual(await gu.getPageNames(), ['Table1']);
  });

  it('Remove should be disabled for last page', async () => {
    // check that Remove is disabled on Table1
    assert.isFalse(await gu.canRemovePage('Table1'));

    // Adds a new page using Table1
    await gu.addNewPage(/Table/, /Table1/);
    assert.deepEqual(await gu.getPageNames(), ['Table1', 'New page']);

    // Add a new table too.
    await gu.addNewTable();
    assert.deepEqual(await gu.getPageNames(), ['Table1', 'New page', 'Table2']);

    // The "Remove" options should now be available on all three items.
    assert.isTrue(await gu.canRemovePage('Table1'));
    assert.isTrue(await gu.canRemovePage('New page'));
    assert.isTrue(await gu.canRemovePage('Table2'));

    // Add Table2 to "New page" (so that it can remain after Table1 is removed below).
    await gu.getPageItem('New page').click();
    await gu.addNewSection(/Table/, /Table2/);

    // Now remove Table1.
    await gu.removeTable('Table1');
    assert.deepEqual(await gu.getPageNames(), ['New page', 'Table2']);

    // Both pages should be removable still.
    assert.isTrue(await gu.canRemovePage('New page'));
    assert.isTrue(await gu.canRemovePage('Table2'));

    // Remove New Page
    await gu.removePage('New page');

    // Now Table2 should not be removable (since it is the last page).
    assert.isFalse(await gu.canRemovePage('Table2'));
  });

  it('should not throw JS errors when removing the current page without a slug', async () => {
    // Create and open new document
    const docId = await session.tempNewDoc(cleanup, "test-page-removal-js-error");
    await driver.get(`${server.getHost()}/o/test-grist/doc/${docId}`);
    await gu.waitForUrl('test-page-removal-js-error');

    // Add two additional tables
    await gu.addNewTable();
    await gu.addNewTable();
    assert.deepEqual(await gu.getPageNames(), ['Table1', 'Table2', 'Table3']);

    // Open the default page (no p/<...> in the URL)
    await driver.get(`${server.getHost()}/o/test-grist/doc/${docId}`);

    // Check that Table1 is now selected
    await driver.findContentWait('.test-treeview-itemHeader.selected', /Table1/, 2000);
    assert.match(await driver.find('.test-treeview-itemHeader.selected').getText(), /Table1/);

    // Remove page Table1
    await gu.removePage('Table1');
    assert.deepEqual(await gu.getPageNames(), ['Table2', 'Table3']);

    // Now check that Table2 is selected
    assert.match(await driver.find('.test-treeview-itemHeader.selected').getText(), /Table2/);

    // Remove page Table2
    await gu.removePage('Table2');
    assert.deepEqual(await gu.getPageNames(), ['Table3']);

    // Check that Table3 is the only page remaining
    assert.deepInclude(await api.getTable(docId, '_grist_Views'), {
      name: ['Table3'],
      id: [3],
    });

    // Check that no JS errors were thrown
    await gu.checkForErrors();
  });

  it('should offer a way to delete last tables', async () => {
    // Create and open new document
    const docId = await session.tempNewDoc(cleanup, "prompts");
    await driver.get(`${server.getHost()}/o/test-grist/doc/${docId}`);
    await gu.waitForUrl('prompts');

    // Add two additional tables, with custom names.
    await gu.addNewTable('Table B');
    await gu.addNewTable('Table C');
    await gu.addNewTable('Table Last');
    assert.deepEqual(await gu.getPageNames(), ['Table1', 'Table B', 'Table C', 'Table Last']);
    await gu.getPageItem('Table C').click();

    // In Table C add Table D (a new one) and Table1 widget (existing);
    await gu.addNewSection(/Table/, /New Table/, { tableName: "Table D"});
    await gu.addNewSection(/Table/, "Table1");
    // New table should not be added as a page
    assert.deepEqual(await gu.getPageNames(), ['Table1', 'Table B', 'Table C', 'Table Last']);
    // Make sure we see proper sections.
    assert.deepEqual(await gu.getSectionTitles(), ['TABLE C', 'TABLE D', 'TABLE1']);

    const revert = await gu.begin();
    // Now removing Table1 page should be done without a prompt (since it is also on Table C)
    await gu.removePage("Table1", { expectPrompt : false });
    assert.deepEqual(await gu.getPageNames(), ['Table B', 'Table C', 'Table Last']);

    // Removing Table B should show prompt (since it is last page)
    await gu.removePage("Table B", { expectPrompt : true, tables: ['Table B'] });
    assert.deepEqual(await gu.getPageNames(), ['Table C', 'Table Last']);

    // Removing page Table C should also show prompt (it is last page for Table1,Table D and TableC)
    await gu.getPageItem('Table Last').click();
    await gu.getPageItem('Table C').click();
    assert.deepEqual(await gu.getSectionTitles(), ['TABLE C', 'TABLE D', 'TABLE1' ]);
    await gu.removePage("Table C", { expectPrompt : true, tables: ['Table D', 'Table C', 'Table1'] });
    assert.deepEqual(await gu.getPageNames(), ['Table Last']);
    await revert();

    assert.deepEqual(await gu.getPageNames(), ['Table1', 'Table B', 'Table C', 'Table Last']);
    assert.deepEqual(await gu.getSectionTitles(), ['TABLE C', 'TABLE D', 'TABLE1' ]);
  });


  async function hideTable(tableId: string) {
    await api.applyUserActions(doc.id, [
      ['AddRecord', '_grist_ACLResources', -1, {tableId, colIds: '*'}],
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -1, aclFormula: '', permissionsText: '-R',
      }],
    ]);
  }
});

async function movePage(page: RegExp, target: {before: RegExp}|{after: RegExp}|{into: RegExp}) {
  const targetReg = values(target)[0];
  await driver.withActions(actions => actions
    .move({origin: driver.findContent('.test-treeview-itemHeader', page)})
    .move({origin: driver.findContent('.test-treeview-itemHeaderWrapper', page)
      .find('.test-treeview-handle')})
    .press()
    .move({origin: driver.findContent('.test-treeview-itemHeader', targetReg),
      y: 'after' in target ? 1 : -1
    })
    .release());
}


async function insertPage(page: RegExp, into: RegExp) {
  await driver.withActions(actions => actions
    .move({origin: driver.findContent('.test-treeview-itemHeader', page)})
    .move({origin: driver.findContent('.test-treeview-itemHeaderWrapper', page)
      .find('.test-treeview-handle')})
    .press()
    .move({origin: driver.findContent('.test-treeview-itemHeader', into),
      y: 5
    })
    .pause(1500) // wait for a target to be highlighted
    .release()
  );
  await gu.waitForServer();
}
