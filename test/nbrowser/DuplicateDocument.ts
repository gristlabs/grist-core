import * as gu from 'test/nbrowser/gristUtils';
import { server, setupTestSuite } from 'test/nbrowser/testUtils';

import { assert, driver, Key } from 'mocha-webdriver';

describe("DuplicateDocument", function() {
  this.timeout(20000);
  const cleanup = setupTestSuite({team: true});

  it("should duplicate a document with the Duplicate-Document option", async function() {
    const session = await gu.session().teamSite.login();
    await session.tempDoc(cleanup, 'Hello.grist');
    await session.tempWorkspace(cleanup, 'Test Workspace');

    // Open the share menu and click item to work on a copy.
    await driver.find('.test-tb-share').click();
    await driver.find('.test-save-copy').click();

    // Should not allow saving a copy to an empty name.
    await driver.findWait('.test-modal-dialog', 1000);
    const nameElem = await driver.findWait('.test-copy-dest-name:focus', 200);
    await nameElem.sendKeys(Key.DELETE);
    assert.equal(await driver.find('.test-modal-confirm').getAttribute('disabled'), 'true');
    await nameElem.sendKeys('  ');
    assert.equal(await driver.find('.test-modal-confirm').getAttribute('disabled'), 'true');
    // As soon as the textbox is non-empty, the Save button should become enabled.
    await nameElem.sendKeys('a');
    await driver.findWait('.test-modal-confirm:not(:disabled)', 5000);

    // Save a copy with a proper name.
    await gu.completeCopy({destName: 'DuplicateTest1', destWorkspace: 'Test Workspace'});

    // check the breadcrumbs reflect new document name, and the doc is not empty.
    assert.equal(await driver.find('.test-bc-doc').value(), 'DuplicateTest1');
    assert.equal(await gu.getCell({col: 'A', rowNum: 1}).getText(), 'hello');
  });

  it("should create a fork with Work-on-a-Copy option", async function() {
    // Main user logs in and import a document
    const session = await gu.session().teamSite.login();
    await session.tempDoc(cleanup, 'Hello.grist');

    // Open the share menu and click item to work on a copy.
    await driver.find('.test-tb-share').click();
    await driver.find('.test-work-on-copy').click();

    await gu.waitForUrl(/~/);
    await gu.waitForDocToLoad();

    // check document is a fork
    assert.equal(await driver.find('.test-unsaved-tag').isPresent(), true);
  });

  // The URL ID of a document copy (named "DuplicateTest2") which we create below and then use in
  // several subsequent test cases.
  let urlId: string;

  it("should allow saving the fork as a new copy", async function() {
    // Make a change to the fork to ensure it's saved.
    await gu.getCell({col: 'A', rowNum: 1}).click();
    await driver.sendKeys('hello to duplicates', Key.ENTER);

    await driver.find('.test-tb-share').click();
    await driver.find('.test-save-copy').click();
    await gu.completeCopy({destName: 'DuplicateTest2', destWorkspace: 'Test Workspace'});
    urlId = (await gu.getCurrentUrlId())!;

    // check the breadcrumbs reflect new document name, and the doc contains our change.
    assert.equal(await driver.find('.test-bc-doc').value(), 'DuplicateTest2');
    assert.equal(await gu.getCell({col: 'A', rowNum: 1}).getText(), 'hello to duplicates');
  });

  it("should offer a choice of orgs when user is owner", async function() {
    if (server.isExternalServer()) {
      this.skip();
    }
    await driver.find('.test-tb-share').click();
    await driver.find('.test-save-copy').click();
    await driver.findWait('.test-modal-dialog', 1000);
    assert.equal(await driver.find('.test-copy-dest-name').value(), 'DuplicateTest2 (copy)');
    assert.equal(await driver.find('.test-copy-dest-org').isPresent(), true);
    await driver.find('.test-copy-dest-org .test-select-open').click();
    assert.includeMembers(await driver.findAll('.test-select-menu li', (el) => el.getText()),
      ['Personal', 'Test Grist', 'Test2 Grist']);
    await driver.sendKeys(Key.ESCAPE);

    // Check the list of workspaces in org
    await driver.findWait('.test-copy-dest-workspace .test-select-open', 1000).click();
    assert.includeMembers(await driver.findAll('.test-select-menu li', (el) => el.getText()),
      ['Home', 'Test Workspace']);
    await driver.sendKeys(Key.ESCAPE);

    // Switch the org and check that workspaces get updated.
    await driver.find('.test-copy-dest-org .test-select-open').click();
    await driver.findContent('.test-select-menu li', 'Test2 Grist').click();
    await driver.findWait('.test-copy-dest-workspace .test-select-open', 1000).click();
    assert.sameMembers(await driver.findAll('.test-select-menu li', (el) => el.getText()),
      ['Home']);
    await driver.sendKeys(Key.ESCAPE);
    await driver.sendKeys(Key.ESCAPE);
  });

  it("should not offer a choice of org when user is not owner", async function() {
    const api = gu.session().teamSite.createHomeApi();
    const session2 = gu.session().teamSite.user('user2');
    await api.updateDocPermissions(urlId, {users: {
      [session2.email]: 'viewers',
    }});

    await session2.login();
    await session2.loadDoc(`/doc/${urlId}`);

    await driver.find('.test-tb-share').click();
    await driver.find('.test-save-copy').click();
    await driver.findWait('.test-modal-dialog', 1000);
    assert.equal(await driver.find('.test-copy-dest-name').value(), 'DuplicateTest2 (copy)');
    // No choice of orgs
    await gu.waitForServer();
    assert.equal(await driver.find('.test-copy-dest-org').isPresent(), false);
    // We don't happen to have write access to any workspace either.
    assert.equal(await driver.find('.test-copy-dest-workspace').isPresent(), false);
    assert.match(await driver.find('.test-copy-warning').getText(),
      /You do not have write access to this site/);
    assert.equal(await driver.find('.test-modal-confirm').getAttribute('disabled'), 'true');
    await driver.sendKeys(Key.ESCAPE);
  });

  it("should offer a choice of orgs when doc is public", async function() {
    if (server.isExternalServer()) {
      this.skip();
    }
    const session = await gu.session().teamSite.login();
    const api = session.createHomeApi();
    // But if the doc is public, then users can copy it out.
    await api.updateDocPermissions(urlId, {users: {
      'everyone@getgrist.com': 'viewers',
    }});
    const session2 = gu.session().teamSite.user('user2');
    await gu.session().teamSite2.createHomeApi().updateOrgPermissions('current', {users: {
      [session2.email]: 'owners',
    }});

    // Reset tracking of the last visited site. We seem to need this now to get consistent
    // behavior across Jenkins and local test runs. (May have something to do with newer
    // versions of chromedriver and headless Chrome.)
    await driver.executeScript('window.sessionStorage.clear();');

    await session2.login();
    await session2.loadDoc(`/doc/${urlId}`);

    await driver.find('.test-tb-share').click();
    await driver.find('.test-save-copy').click();
    await driver.findWait('.test-modal-dialog', 1000);
    assert.equal(await driver.find('.test-copy-dest-name').value(), 'DuplicateTest2 (copy)');

    // We can now switch between orgs.
    assert.equal(await driver.find('.test-copy-dest-org').isPresent(), true);

    // But we still don't have any writable workspaces on the current site.
    await gu.waitForServer();
    assert.equal(await driver.find('.test-copy-dest-workspace').isPresent(), false);
    assert.match(await driver.find('.test-copy-warning').getText(),
      /You do not have write access to this site/);
    assert.equal(await driver.find('.test-modal-confirm').getAttribute('disabled'), 'true');

    // We see some good orgs.
    await driver.find('.test-copy-dest-org .test-select-open').click();
    assert.includeMembers(await driver.findAll('.test-select-menu li', (el) => el.getText()),
      ['Personal', 'Test Grist', 'Test2 Grist']);

    // Switching to an accessible regular org shows workspaces.
    await driver.findContent('.test-select-menu li', 'Test2 Grist').click();
    await gu.waitForServer();
    await driver.find('.test-copy-dest-workspace .test-select-open').click();
    assert.sameMembers(await driver.findAll('.test-select-menu li', (el) => el.getText()),
      ['Home']);
    assert.equal(await driver.find('.test-modal-confirm').getAttribute('disabled'), null);

    // And saving to another org actually works.
    await gu.completeCopy();
    assert.equal(await driver.find('.test-dm-org').getText(), 'Test2 Grist');
    assert.equal(await driver.find('.test-bc-doc').value(), 'DuplicateTest2 (copy)');
    assert.equal(await driver.find('.test-bc-workspace').getText(), 'Home');
    assert.equal(await gu.getCell({col: 'A', rowNum: 1}).getText(), 'hello to duplicates');
  });

  it("should allow saving a public doc to the personal org", async function() {
    if (server.isExternalServer()) {
      this.skip();
    }
    const session2 = gu.session().teamSite.user('user2');
    await session2.login();
    await session2.loadDoc(`/doc/${urlId}`);

    // Open the "Duplicate Document" dialog.
    await driver.find('.test-tb-share').click();
    await driver.find('.test-save-copy').click();
    await driver.findWait('.test-modal-dialog', 1000);
    assert.equal(await driver.find('.test-copy-dest-name').value(), 'DuplicateTest2 (copy)');

    // Switching to personal org shows no workspaces but no errors either.
    await driver.find('.test-copy-dest-org .test-select-open').click();
    await driver.findContent('.test-select-menu li', 'Personal').click();
    await gu.waitForServer();
    assert.equal(await driver.find('.test-copy-warning').isPresent(), false);
    assert.equal(await driver.find('.test-modal-confirm').getAttribute('disabled'), null);

    // Save; it should succeed and open a same-looking document in alternate user's personal org.
    const name = session2.name;
    await gu.completeCopy({destName: `DuplicateTest2 ${name} Copy`});
    assert.equal(await driver.find('.test-dm-org').getText(), `@${name}`);
    assert.equal(await driver.find('.test-bc-doc').value(), `DuplicateTest2 ${name} Copy`);
    assert.equal(await driver.find('.test-bc-workspace').getText(), 'Home');
    assert.equal(await gu.getCell({col: 'A', rowNum: 1}).getText(), 'hello to duplicates');
    assert.notEqual(await gu.getCurrentUrlId(), urlId);

    // Remove document
    await driver.find(".test-bc-workspace").click();
    await gu.removeDoc(`DuplicateTest2 ${name} Copy`);
  });

  it("should not auto-start tour if a document with a tour is copied as a template", async function() {
    const session = await gu.session().teamSite.login();
    await session.tempDoc(cleanup, 'doctour.grist');
    await session.tempWorkspace(cleanup, 'Test Workspace');
    assert.isTrue(await driver.findWait('.test-onboarding-popup', 1000).isPresent());
    await driver.find('.test-onboarding-close').click();
    await gu.waitForServer();

    await driver.find('.test-tb-share').click();
    await driver.find('.test-save-copy').click();
    await driver.findWait('.test-modal-dialog', 1000);
    await driver.find('.test-save-as-template').click();
    await gu.completeCopy({destName: 'DuplicateTest3', destWorkspace: 'Test Workspace'});

    // Give it a second, just to be sure the tour doesn't appear.
    await driver.sleep(1000);
    assert.isFalse(await driver.find('.test-onboarding-popup').isPresent());
  });
});
