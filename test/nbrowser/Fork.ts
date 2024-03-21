import {DocCreationInfo} from 'app/common/DocListAPI';
import {UserAPI} from 'app/common/UserAPI';
import {assert, driver, Key} from 'mocha-webdriver';
import * as gu from 'test/nbrowser/gristUtils';
import {server, setupTestSuite} from 'test/nbrowser/testUtils';
import uuidv4 from "uuid/v4";

describe("Fork", function() {

  // this is a relatively slow test in staging.
  this.timeout(60000);
  const cleanup = setupTestSuite();

  let doc: DocCreationInfo;
  let api: UserAPI;
  let personal: gu.Session;
  let team: gu.Session;

  before(async function() {
    personal = gu.session().personalSite;
    team = gu.session().teamSite;
  });

  async function makeDocIfAbsent() {
    if (doc && doc.id) { return; }
    doc = await team.tempDoc(cleanup, 'Hello.grist', {load: false});
  }

  async function getForks(api: UserAPI) {
    const wss = await api.getOrgWorkspaces('current');
    const forks = wss
      .find(ws => ws.name === team.workspace)
      ?.docs
      .find(d => d.id === doc.id)
      ?.forks;
    return forks ?? [];
  }

  async function testForksOfForks(isLoggedIn: boolean = true) {
    const session = isLoggedIn ? await team.login() : await team.anon.login();
    await session.loadDoc(`/doc/${doc.id}/m/fork`);
    await gu.getCell({rowNum: 1, col: 0}).click();
    await gu.enterCell('1');
    await gu.waitForServer();
    assert.equal(await gu.getCell({rowNum: 1, col: 0}).getText(), '1');
    const forkUrl = await driver.getCurrentUrl();
    assert.match(forkUrl, isLoggedIn ? /^[^~]*~[^~]+~\d+$/ : /^[^~]*~[^~]*$/);
    await gu.refreshDismiss();
    await session.loadDoc((new URL(forkUrl)).pathname + '/m/fork');
    await gu.getCell({rowNum: 1, col: 0}).click();
    await gu.enterCell('2');
    await gu.waitForServer();
    await driver.findContentWait(
      '.test-notifier-toast-wrapper',
      /Cannot fork a document that's already a fork.*Report a problem/s,
      2000
    );
    assert.equal(await gu.getCell({rowNum: 1, col: 0}).getText(), '1');
    assert.equal(await driver.getCurrentUrl(), `${forkUrl}/m/fork`);
    await gu.wipeToasts();
    await gu.refreshDismiss();
  }

  // Run tests with both regular docId and a custom urlId in URL, to make sure
  // ids are kept straight during forking.

  for (const idType of ['urlId', 'docId'] as Array<'docId'|'urlId'>) {
    describe(`with ${idType} in url`, function() {

      before(async function() {
        // Chimpy imports a document
        await team.login();
        await makeDocIfAbsent();

        // Chimpy invites anon to view this document as a viewer, and charon as an owner
        api = team.createHomeApi();
        const user2 = gu.session().user('user2').email;
        const user3 = gu.session().user('user3').email;
        await api.updateDocPermissions(doc.id, {users: {'anon@getgrist.com': 'viewers',
                                                        [user3]: 'viewers',
                                                        [user2]: 'owners'}});

        // Optionally set a urlId
        if (idType === 'urlId') {
          await api.updateDoc(doc.id, {urlId: 'doc-ula'});
        }
      });

      afterEach(() => gu.checkForErrors());

      for (const mode of ['anonymous', 'logged in']) {
        for (const content of ['empty', 'imported']) {
          it(`can create an ${content} unsaved document when ${mode}`, async function() {
            let visitedSites: string[];
            if (mode === 'anonymous') {
              visitedSites = ['@Guest'];
              await personal.anon.login();
            } else {
              visitedSites = ['Test Grist', `@${personal.name}`];
              await personal.login();
            }
            const anonApi = personal.anon.createHomeApi();
            const activeApi = (mode === 'anonymous') ? anonApi : api;
            const id = await (content === 'empty' ? activeApi.newUnsavedDoc() :
                              activeApi.importUnsavedDoc(Buffer.from('A,B\n999,2\n'),
                                                         {filename: 'foo.csv'}));
            await personal.loadDoc(`/doc/${id}`);
            await gu.dismissWelcomeTourIfNeeded();
            // check that the tag is there
            assert.equal(await driver.find('.test-unsaved-tag').isPresent(), true);
            // check that the org name area is showing one of the last visited sites. this is
            // an imprecise check; doing an assert.equal instead is possible, but would require
            // changing this test significantly.
            assert.include(visitedSites, await driver.find('.test-dm-org').getText());
            if (content === 'imported') {
              assert.equal(await gu.getCell({rowNum: 1, col: 0}).getText(), '999');
            } else {
              assert.equal(await gu.getCell({rowNum: 1, col: 0}).getText(), '');
            }
            // editing should work
            await gu.getCell({rowNum: 1, col: 0}).click();
            await gu.enterCell('123');
            await gu.waitForServer();
            assert.equal(await gu.getCell({rowNum: 1, col: 0}).getText(), '123');
            await gu.refreshDismiss();
            // edits should persist across reloads
            await personal.loadDoc(`/doc/${id}`);
            assert.equal(await gu.getCell({rowNum: 1, col: 0}).getText(), '123');
            // edits should still work
            await gu.getCell({rowNum: 1, col: 0}).click();
            await gu.enterCell('234');
            await gu.waitForServer();
            assert.equal(await gu.getCell({rowNum: 1, col: 0}).getText(), '234');
            await gu.refreshDismiss();

            if (mode !== 'anonymous') {
              // if we log out, access should now be denied
              const anonSession = await personal.anon.login();
              await anonSession.loadDoc(`/doc/${id}`, {wait: false});
              assert.match(await driver.findWait('.test-error-header', 2000).getText(), /Access denied/);

              // if we log in as a different user, access should be denied
              const altSession = await personal.user('user2').login();
              await altSession.loadDoc(`/doc/${id}`, {wait: false});
              assert.match(await driver.findWait('.test-error-header', 2000).getText(), /Access denied/);
            }
          });
        }
      }

      it('allows a document to be forked anonymously', async function() {
        // Anon loads the document, tries to modify, and fails - no write access
        const anonSession = await team.anon.login();
        await anonSession.loadDoc(`/doc/${doc.id}`);
        await gu.getCell({rowNum: 1, col: 0}).click();
        await gu.enterCell('123');
        await gu.waitForServer();
        assert.notEqual(await gu.getCell({rowNum: 1, col: 0}).value(), '123');
        // check that there is no tag
        assert.equal(await driver.find('.test-unsaved-tag').isPresent(), false);

        // Anon forks the document, tries to modify, and succeeds
        await anonSession.loadDoc(`/doc/${doc.id}/m/fork`);
        await gu.getCell({rowNum: 1, col: 0}).click();
        await gu.enterCell('123');

        // Check that we show some indicators of what's happening to the user in notification toasts
        // (but allow for possibility that things are changing fast).
        await driver.findContentWait('.test-notifier-toast-message',
                                     /(Preparing your copy)|(You are now.*your own copy)/, 2000);
        await gu.waitForServer();
        await driver.findContentWait('.test-notifier-toast-message', /You are now.*your own copy/, 2000);
        assert.equal(await driver.findContent('.test-notifier-toast-message', /Preparing/).isPresent(), false);

        assert.equal(await gu.getCell({rowNum: 1, col: 0}).getText(), '123');
        await gu.getCell({rowNum: 2, col: 0}).click();
        await gu.enterCell('234');
        await gu.waitForServer();
        assert.equal(await gu.getCell({rowNum: 2, col: 0}).getText(), '234');

        // The url of the doc should now be that of a fork
        const forkUrl = await driver.getCurrentUrl();
        assert.match(forkUrl, /~/);
        // check that the tag is there
        assert.equal(await driver.find('.test-unsaved-tag').isPresent(), true);
        await gu.refreshDismiss();

        // Open the original url and make sure the change we made is not there
        await anonSession.loadDoc(`/doc/${doc.id}`);
        assert.notEqual(await gu.getCell({rowNum: 1, col: 0}).value(), '123');
        assert.notEqual(await gu.getCell({rowNum: 2, col: 0}).value(), '234');
        assert.equal(await driver.find('.test-unsaved-tag').isPresent(), false);

        // Open the fork url and make sure the change we made is persisted there
        await anonSession.loadDoc((new URL(forkUrl)).pathname);
        assert.equal(await gu.getCell({rowNum: 1, col: 0}).getText(), '123');
        assert.equal(await gu.getCell({rowNum: 2, col: 0}).getText(), '234');
        assert.equal(await driver.find('.test-unsaved-tag').isPresent(), true);
      });

      it('allows a document to be forked anonymously multiple times', async function() {
        // Anon forks the document, tries to modify, and succeeds
        const anonSession = await team.anon.login();
        await anonSession.loadDoc(`/doc/${doc.id}/m/fork`);
        await gu.getCell({rowNum: 1, col: 0}).click();
        await gu.enterCell('1');
        await gu.waitForServer();
        assert.equal(await gu.getCell({rowNum: 1, col: 0}).getText(), '1');
        const fork1 = await driver.getCurrentUrl();
        await gu.refreshDismiss();

        await anonSession.loadDoc(`/doc/${doc.id}/m/fork`);
        await gu.getCell({rowNum: 1, col: 0}).click();
        await gu.enterCell('2');
        await gu.waitForServer();
        assert.equal(await gu.getCell({rowNum: 1, col: 0}).getText(), '2');
        const fork2 = await driver.getCurrentUrl();
        await gu.refreshDismiss();

        await anonSession.loadDoc((new URL(fork1)).pathname);
        assert.equal(await gu.getCell({rowNum: 1, col: 0}).getText(), '1');

        await anonSession.loadDoc((new URL(fork2)).pathname);
        assert.equal(await gu.getCell({rowNum: 1, col: 0}).getText(), '2');
      });

      it('does not allow an anonymous fork to be forked', () => testForksOfForks(false));

      it('shows the right page item after forking', async function() {
        const anonSession = await team.anon.login();
        await anonSession.loadDoc(`/doc/${doc.id}/m/fork`);
        assert.match(await driver.find('.test-treeview-itemHeader.selected').getText(), /Table1/);

        // Add a new page; this immediately triggers a fork, AND selects the new page in it.
        await gu.addNewPage(/Table/, /New Table/, {dismissTips: true});
        const urlId1 = await gu.getCurrentUrlId();
        assert.match(urlId1!, /~/);
        assert.match(await driver.find('.test-treeview-itemHeader.selected').getText(), /Table2/);
        await gu.refreshDismiss();
      });

      for (const user of [{access: 'viewers', name: 'user3'},
                          {access: 'editors', name: 'user2'}]) {
        it(`allows a logged in user with ${user.access} permissions to fork`, async function() {
          const userSession = await gu.session().teamSite.user(user.name as any).login();
          await userSession.loadDoc(`/doc/${doc.id}/m/fork`);
          assert.equal(await gu.getEmail(), userSession.email);
          assert.equal(await driver.find('.test-unsaved-tag').isPresent(), false);
          // Dismiss forms announcement popup, if present.
          await gu.dismissBehavioralPrompts();
          await gu.getCell({rowNum: 1, col: 0}).click();
          await gu.enterCell('123');
          await gu.waitForServer();
          assert.equal(await driver.findWait('.test-unsaved-tag', 4000).isPresent(), true);
          await gu.getCell({rowNum: 2, col: 0}).click();
          await gu.enterCell('234');
          await gu.waitForServer();
          assert.equal(await gu.getCell({rowNum: 2, col: 0}).getText(), '234');

          // The url of the doc should now be that of a fork
          const forkUrl = await driver.getCurrentUrl();
          assert.match(forkUrl, /~/);

          // Check that the fork was saved to the home db
          const api = userSession.createHomeApi();
          const forks = await getForks(api);
          const forkId = forkUrl.match(/\/[\w-]+~(\w+)(?:~\w)?/)?.[1];
          const fork = forks.find(f => f.id === forkId);
          assert.isDefined(fork);
          assert.equal(fork!.trunkId, doc.id);
          await gu.refreshDismiss();

          // Open the original url and make sure the change we made is not there
          await userSession.loadDoc(`/doc/${doc.id}`);
          assert.notEqual(await gu.getCell({rowNum: 1, col: 0}).value(), '123');
          assert.notEqual(await gu.getCell({rowNum: 2, col: 0}).value(), '234');

          // Open the fork url and make sure the change we made is persisted there
          await userSession.loadDoc((new URL(forkUrl)).pathname);
          assert.notEqual(await gu.getCell({rowNum: 2, col: 0}).value(), '234');
          assert.equal(await gu.getCell({rowNum: 1, col: 0}).getText(), '123');
          assert.equal(await gu.getCell({rowNum: 2, col: 0}).getText(), '234');

          // Check we still have editing rights
          await gu.getCell({rowNum: 1, col: 0}).click();
          await gu.enterCell('1234');
          await gu.waitForServer();
          await gu.refreshDismiss();
          await userSession.loadDoc((new URL(forkUrl)).pathname);
          assert.equal(await gu.getCell({rowNum: 1, col: 0}).getText(), '1234');

          // Check others with write access to trunk can view but not edit our
          // fork
          await team.login();
          await team.loadDoc((new URL(forkUrl)).pathname);
          assert.equal(await gu.getEmail(), team.email);
          assert.equal(await gu.getCell({rowNum: 1, col: 0}).getText(), '1234');
          await gu.getCell({rowNum: 1, col: 0}).click();
          await gu.enterCell('12345');
          await gu.waitForServer();
          await gu.refreshDismiss();
          await team.loadDoc((new URL(forkUrl)).pathname);
          assert.equal(await gu.getCell({rowNum: 1, col: 0}).getText(), '1234');

          const anonSession = await team.anon.login();
          await anonSession.loadDoc((new URL(forkUrl)).pathname);
          assert.equal(await gu.getEmail(), 'anon@getgrist.com');
          assert.equal(await gu.getCell({rowNum: 1, col: 0}).getText(), '1234');
          await gu.getCell({rowNum: 1, col: 0}).click();
          await gu.enterCell('12345');
          await gu.waitForServer();
          await gu.refreshDismiss();
          await anonSession.loadDoc((new URL(forkUrl)).pathname);
          assert.equal(await gu.getCell({rowNum: 1, col: 0}).getText(), '1234');
        });
      }

      it('controls access to forks of a logged in user correctly', async function() {
        await gu.removeLogin();
        const doc2 = await team.tempDoc(cleanup, 'Hello.grist', {load: false});
        await api.updateDocPermissions(doc2.id, {maxInheritedRole: null});
        await team.login();
        await team.loadDoc(`/doc/${doc2.id}/m/fork`);
        await gu.getCell({rowNum: 1, col: 0}).click();
        await gu.enterCell('123');
        await gu.waitForServer();

        // The url of the doc should now be that of a fork
        const forkUrl = await driver.getCurrentUrl();
        assert.match(forkUrl, /~/);
        await gu.refreshDismiss();

        // Open the original url and make sure the change we made is not there
        await team.loadDoc(`/doc/${doc2.id}`);
        assert.notEqual(await gu.getCell({rowNum: 1, col: 0}).value(), '123');

        // Open the fork url and make sure the change we made is persisted there
        await team.loadDoc((new URL(forkUrl)).pathname);
        assert.equal(await gu.getCell({rowNum: 1, col: 0}).getText(), '123');

        // Check we still have editing rights
        await gu.getCell({rowNum: 1, col: 0}).click();
        await gu.enterCell('1234');
        await gu.waitForServer();
        await gu.refreshDismiss();
        await team.loadDoc((new URL(forkUrl)).pathname);
        assert.equal(await gu.getCell({rowNum: 1, col: 0}).getText(), '1234');

        // Check others without view access to trunk cannot see fork
        await team.user('user2').login();
        await driver.get(forkUrl);
        assert.match(await driver.findWait('.test-error-header', 2000).getText(), /Access denied/);
        assert.equal(await driver.find('.test-dm-logo').isDisplayed(), true);

        await server.removeLogin();
        await driver.get(forkUrl);
        assert.match(await driver.findWait('.test-error-header', 2000).getText(), /Access denied/);
        assert.equal(await driver.find('.test-dm-logo').isDisplayed(), true);
      });

      it('fails to create forks with inconsistent user id', async function() {
        // Note: this test is also valuable for triggering an error during openDoc flow even though
        // the initial page load succeeds, and checking how such an error is shown.

        const forkId = `${idType}fork${uuidv4()}`;
        await team.login();
        const userId = await team.getUserId();
        const altSession = await team.user('user2').login();
        await altSession.loadDoc(`/doc/${doc.id}~${forkId}~${userId}`, {wait: false});

        assert.equal(await driver.findWait('.test-modal-dialog', 2000).isDisplayed(), true);
        assert.match(await driver.find('.test-modal-dialog').getText(), /Document fork not found/);

        // Ensure the user has a way to report the problem (although including the report button in
        // the modal might be better).
        assert.match(await driver.find('.test-notifier-toast-wrapper').getText(),
                     /Document fork not found.*Report a problem/s);

        // A new doc cannot be created either (because of access
        // mismatch - for forks of the doc used in these tests, user2
        // would have some access to fork via acls on trunk, but for a
        // new doc user2 has no access granted via the doc, or
        // workspace, or org).
        await altSession.loadDoc(`/doc/new~${forkId}~${userId}`, {wait: false});
        assert.match(await driver.findWait('.test-error-header', 2000).getText(), /Access denied/);
        assert.equal(await driver.find('.test-dm-logo').isDisplayed(), true);

        // Same, but as an anonymous user.
        const anonSession = await altSession.anon.login();
        await anonSession.loadDoc(`/doc/${doc.id}~${forkId}~${userId}`, {wait: false});
        assert.equal(await driver.findWait('.test-modal-dialog', 2000).isDisplayed(), true);
        assert.match(await driver.find('.test-modal-dialog').getText(), /Document fork not found/);

        // A new doc cannot be created either (because of access mismatch).
        await altSession.loadDoc(`/doc/new~${forkId}~${userId}`, {wait: false});
        assert.match(await driver.findWait('.test-error-header', 2000).getText(), /Access denied/);
        assert.equal(await driver.find('.test-dm-logo').isDisplayed(), true);

        // Now as a user who *is* allowed to create the fork.
        // But doc forks cannot be casually created this way anymore, so it still doesn't work.
        await team.login();
        await team.loadDoc(`/doc/${doc.id}~${forkId}~${userId}`, {wait: false});
        assert.equal(await driver.findWait('.test-modal-dialog', 2000).isDisplayed(), true);
        assert.match(await driver.find('.test-modal-dialog').getText(), /Document fork not found/);

        // New document can no longer be casually created this way anymore either.
        await team.loadDoc(`/doc/new~${forkId}~${userId}`, {wait: false});
        assert.equal(await driver.findWait('.test-modal-dialog', 2000).isDisplayed(), true);
        assert.match(await driver.find('.test-modal-dialog').getText(), /Document fork not found/);
        await gu.wipeToasts();
      });

      it("should include the unsaved tags", async function() {
        await team.login();
        // open a document
        const trunk = await team.tempDoc(cleanup, 'World.grist');

        // make a fork
        await team.loadDoc(`/doc/${trunk.id}/m/fork`);
        await gu.getCell({rowNum: 1, col: 0}).click();
        await gu.enterCell('123');
        await gu.waitForServer();
        const forkUrl = await driver.getCurrentUrl();
        assert.match(forkUrl, /~/);
        await gu.refreshDismiss();

        // check that there is no tag on trunk
        await team.loadDoc(`/doc/${trunk.id}`);
        assert.equal(await driver.find('.test-unsaved-tag').isPresent(), false);

        // open same document with the fork bit in the URL
        await team.loadDoc((new URL(forkUrl)).pathname);

        // check that the tag is there
        assert.equal(await driver.find('.test-unsaved-tag').isPresent(), true);
      });

      it('handles url history correctly', async function() {
        await team.login();
        await makeDocIfAbsent();
        await team.loadDoc(`/doc/${doc.id}/m/fork`);
        const initialUrl = await driver.getCurrentUrl();
        assert.equal(await driver.find('.test-unsaved-tag').isPresent(), false);
        await gu.getCell({rowNum: 1, col: 0}).click();
        await gu.enterCell('2');
        await gu.waitForServer();
        assert.equal(await gu.getCell({rowNum: 1, col: 0}).getText(), '2');
        const forkUrl = await driver.getCurrentUrl();
        assert.equal(await driver.findWait('.test-unsaved-tag', 4000).isPresent(), true);

        await driver.executeScript('history.back()');
        await gu.waitForUrl(/\/m\/fork/);
        assert.equal(await driver.getCurrentUrl(), initialUrl);
        await gu.waitForDocToLoad();
        assert.equal(await gu.getCell({rowNum: 1, col: 0}).getText(), 'hello');
        assert.equal(await driver.find('.test-unsaved-tag').isPresent(), false);

        await driver.executeScript('history.forward()');
        await gu.waitForUrl(/~/);
        assert.equal(await driver.getCurrentUrl(), forkUrl);
        await gu.waitForDocToLoad();
        assert.equal(await gu.getCell({rowNum: 1, col: 0}).getText(), '2');
        assert.equal(await driver.find('.test-unsaved-tag').isPresent(), true);
        await gu.refreshDismiss();
      });

      it('disables document renaming for forks', async function() {
        await team.login();
        await team.loadDoc(`/doc/${doc.id}/m/fork`);
        assert.equal(await driver.find('.test-bc-doc').getAttribute('disabled'), null);
        await gu.getCell({rowNum: 1, col: 0}).click();
        await gu.enterCell('2');
        await gu.waitForServer();
        await gu.waitToPass(async () => {
          assert.equal(await driver.find('.test-bc-doc').getAttribute('disabled'), 'true');
        });
        await gu.refreshDismiss();
      });

      it('navigating browser history play well with the add new menu', async function() {

        await team.login();
        await makeDocIfAbsent();
        await team.loadDoc(`/doc/${doc.id}/m/fork`);
        const count = await getAddNewEntryCount();

        // edit one cell
        await gu.getCell({rowNum: 1, col: 0}).click();
        await gu.enterCell('2');
        await gu.waitForServer();

        // check we're on a fork
        await gu.waitForUrl(/~/);

        // navigate back history
        await driver.navigate().back();
        await gu.waitForDocToLoad();

        // check number of entries in add new menu are the same
        assert.equal(await getAddNewEntryCount(), count);

        // helper that get the number of items in the add new menu
        async function getAddNewEntryCount() {
          await driver.find('.test-dp-add-new').click();
          const items = await driver.findAll('.grist-floating-menu li', e => e.getText());
          assert.include(items, "Import from file");
          await driver.sendKeys(Key.ESCAPE);
          return items.length;
        }
      });

      it('can replace a trunk document with a fork via api', async function() {

        await team.login();
        await makeDocIfAbsent();
        await team.loadDoc(`/doc/${doc.id}/m/fork`);

        // edit one cell
        await gu.getCell({rowNum: 2, col: 0}).click();
        const v1 = await gu.getCell({rowNum: 2, col: 0}).getText();
        const v2 = `${v1}_tweaked`;
        await gu.enterCell(v2);
        await gu.waitForServer();

        // check we're on a fork
        await gu.waitForUrl(/~/);
        const urlId = await gu.getCurrentUrlId();
        await gu.refreshDismiss();

        // open trunk again, to test that page is reloaded after replacement
        await team.loadDoc(`/doc/${doc.id}`);

        // replace the trunk with the fork
        assert.notEqual(urlId, doc.id);
        assert.equal(await gu.getCell({rowNum: 2, col: 0}).getText(), v1);
        const docApi = team.createHomeApi().getDocAPI(doc.id);
        await docApi.replace({sourceDocId: urlId!});

        // check that replacement worked (giving a little time for page reload)
        await gu.waitToPass(async () => {
          assert.equal(await gu.getCell({rowNum: 2, col: 0}).getText(), v2);
        }, 4000);

        // have a different user make a doc we don't have access to
        const altSession = await personal.user('user2').login();
        const altDoc = await altSession.tempDoc(cleanup, 'Hello.grist');
        await gu.dismissWelcomeTourIfNeeded();
        await gu.getCell({rowNum: 2, col: 0}).click();
        await gu.enterCell('altDoc');
        await gu.waitForServer();

        // replacement should fail for document not found
        // (error is "not found" for document in a different team site
        // or team site vs personal site)
        await assert.isRejected(docApi.replace({sourceDocId: altDoc.id}), /not found/);
        // replacement should fail for document not accessible
        await assert.isRejected(personal.createHomeApi().getDocAPI(doc.id).replace({sourceDocId: altDoc.id}),
                                /access denied/);

        // check cell content does not change
        await altSession.loadDoc(`/doc/${altDoc.id}`);
        assert.equal(await gu.getCell({rowNum: 2, col: 0}).getText(), 'altDoc');
        await team.login();
        await team.loadDoc(`/doc/${doc.id}`);
        assert.equal(await gu.getCell({rowNum: 2, col: 0}).getText(), v2);
      });

      it('can replace a trunk document with a fork via UI', async function() {

        await team.login();
        await makeDocIfAbsent();
        await team.loadDoc(`/doc/${doc.id}/m/fork`);

        // edit one cell.
        await gu.getCell({rowNum: 2, col: 0}).click();
        const v1 = await gu.getCell({rowNum: 2, col: 0}).getText();
        const v2 = `${v1}_tweaked`;
        await gu.enterCell(v2);
        await gu.waitForServer();

        // check we're on a fork.
        await gu.waitForUrl(/~/);
        const forkUrlId = await gu.getCurrentUrlId();
        assert.equal(await driver.findWait('.test-unsaved-tag', 4000).isPresent(), true);

        // check Replace Original gives expected button, and press it.
        await driver.find('.test-tb-share').click();
        await driver.find('.test-replace-original').click();
        let confirmButton = driver.findWait('.test-modal-confirm', 3000);
        assert.equal(await confirmButton.getText(), 'Update');
        await confirmButton.click();

        // check we're no longer on a fork, but still have the change made on the fork.
        await gu.waitForUrl(/^[^~]*$/, 6000);
        await gu.waitForDocToLoad();
        assert.equal(await gu.getCell({rowNum: 2, col: 0}).getText(), v2);

        // edit the cell again.
        await gu.getCell({rowNum: 2, col: 0}).click();
        const v3 = `${v2}_tweaked`;
        await gu.enterCell(v3);
        await gu.waitForServer();

        // revisit the fork.
        await team.loadDoc(`/doc/${forkUrlId}`);
        assert.equal(await driver.findWait('.test-unsaved-tag', 4000).isPresent(), true);
        // check Replace Original gives a scarier button, and press it anyway.
        await driver.find('.test-tb-share').click();
        await driver.find('.test-replace-original').click();
        confirmButton = driver.findWait('.test-modal-confirm', 3000);
        assert.equal(await confirmButton.getText(), 'Overwrite');
        await confirmButton.click();

        // check we're no longer on a fork, but have the fork's content.
        await gu.waitForUrl(/^[^~]*$/, 6000);
        await gu.waitForDocToLoad();
        assert.equal(await gu.getCell({rowNum: 2, col: 0}).getText(), v2);

        // revisit the fork.
        await team.loadDoc(`/doc/${forkUrlId}`);
        assert.equal(await driver.findWait('.test-unsaved-tag', 4000).isPresent(), true);
        // check Replace Original mentions that the document is the same as the trunk.
        await driver.find('.test-tb-share').click();
        await driver.find('.test-replace-original').click();
        confirmButton = driver.findWait('.test-modal-confirm', 3000);
        assert.equal(await confirmButton.getText(), 'Update');
        assert.match(await driver.find('.test-modal-dialog').getText(),
                     /already identical/);
        await gu.refreshDismiss();
      });

      it('gives an error when replacing without write access via UI', async function() {
        await team.login();
        await makeDocIfAbsent();

        // Give view access to a friend.
        const altSession = await team.user('user2').login();
        await api.updateDocPermissions(doc.id, {users: {[altSession.email]: 'viewers'}});
        try {
          await team.loadDoc(`/doc/${doc.id}/m/fork`);

          // edit one cell.
          await gu.getCell({rowNum: 2, col: 0}).click();
          const v1 = await gu.getCell({rowNum: 2, col: 0}).getText();
          const v2 = `${v1}_tweaked`;
          await gu.enterCell(v2);
          await gu.waitForServer();

          // check we're on a fork.
          await gu.waitForUrl(/~/);
          await gu.waitForDocToLoad();
          assert.equal(await driver.findWait('.test-unsaved-tag', 4000).isPresent(), true);

          // check Replace Original does not let us proceed because we don't have
          // editing rights on trunk.
          await driver.find('.test-tb-share').click();
          assert.equal(await driver.find('.test-replace-original').matches('.disabled'), true);
          // Clicking the disabled element does nothing.
          await driver.find('.test-replace-original').click();
          assert.equal(await driver.find('.grist-floating-menu').isDisplayed(), true);
          await assert.isRejected(driver.findWait('.test-modal-dialog', 500), /Waiting for element/);
          await gu.refreshDismiss();
        } finally {
          await api.updateDocPermissions(doc.id, {users: {[altSession.email]: null}});
        }
      });

      it('does not allow a fork to be forked', testForksOfForks);
    });
  }
});
