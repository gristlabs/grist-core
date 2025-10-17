import {DocCreationInfo} from 'app/common/DocListAPI';
import {UserAPI} from 'app/common/UserAPI';
import {assert, driver} from 'mocha-webdriver';
import * as gu from 'test/nbrowser/gristUtils';
import {server} from 'test/nbrowser/testServer';
import {setupTestSuite} from 'test/nbrowser/testUtils';

describe('DocTour', function () {
  this.timeout(30000);
  const cleanup = setupTestSuite();

  let api: UserAPI;
  let doc: DocCreationInfo;

  before(async function() {
    api = gu.createHomeApi('chimpy', 'nasa');
    doc = await gu.importFixturesDoc(
      'chimpy', 'nasa', 'Horizon', 'doctour.grist', false
    );
    await server.simulateLogin("Chimpy", "chimpy@getgrist.com", 'nasa');
  });

  after(async function() {
    // Revert changes to document access.
    await api.updateDocPermissions(doc.id, {users: {'kiwi@getgrist.com': null, 'charon@getgrist.com': null}});
  });

  afterEach(() => gu.checkForErrors());

  /*
  To see what this document tour is like:
  1. Open the doctour.grist fixture
  2. Click the links under 'Location' to see which cells they point to
  3. Open the link in the last column to conveniently open the document with #repeat-doc-tour at the end.
     Apparently this doesn't work without reloading so I suggest Ctrl+click or middle click to open in a new tab.

  The rows in the table are not in the same order as their row IDs, i.e. the table tests that
  using manualSort works correctly to create popups in the order the user sees in the table.

  The last row has no title or body so no popup is created for it.
   */

  it('should create correct popups from a GristDocTour table', async () => {
    await gu.loadDoc(`/o/nasa/doc/${doc.id}#repeat-doc-tour`);
    await gu.waitForDocToLoad();

    const docTour = await driver.executeScript('return window._gristDocTour()');
    assert.deepEqual(docTour, [
      {
        body: '<span>' +
          '<p>General Kenobi!</p>\n' +
          '</span>',
        placement: 'bottom',
        selector: '.active_cursor',
        showHasModal: false,
        title: 'Hello there!',
        urlState: {colRef: 2, rowId: 2, sectionId: 1}
      },
      {
        body: '<span>' +
          '<p>no title</p>\n' +
          '</span>',
        placement: 'auto',
        selector: '.active_cursor',
        showHasModal: true,
        title: '',
        urlState: null,
      },
      {
        body: '<span>' +
          '<span></span>' +
          '<p><div class="_grainXXX_">' +
          '<a href="https://www.getgrist.com/" target="_blank" class="_grainXXX_ _grainXXX_">' +
          '<div class="_grainXXX_ _grainXXX_" style="mask-image: var(--icon-Page);"></div>' +
          'A link with an icon' +
          '</a>' +
          '</div></p>' +
          '</span>',
        placement: 'auto',
        selector: '.active_cursor',
        showHasModal: false,
        title: 'no body',
        urlState: {colRef: 4, rowId: 4, sectionId: 1}
      },
      {
        body: '<span><span>' +
          '<p>Good riddance</p>\n</span>' +
          '<p><div class="_grainXXX_">' +
          '<a href="https://xkcd.com/" target="_blank" class="_grainXXX_ _grainXXX_">' +
          'Test link here' +
          '</a>' +
          '</div></p>' +
          '</span>',
        placement: 'auto',
        selector: '.active_cursor',
        showHasModal: true,
        title: 'Bye',
        urlState: null,
      },
      {
        body: '<span><p>' +
          '<strong>bold</strong>' +
          ' <em>italicized</em>' +
          ' <code>code</code>' +
          ' <del>strikethrough</del>' +
          '</p>\n' +
          '</span>',
        placement: 'auto',
        selector: '.active_cursor',
        showHasModal: true,
        title: 'Markdown formating',
        urlState: null,
      },
      {
        body: '<span><p>' +
          '![Grist text as image alt](https://www.getgrist.com/wp-content/uploads/2023/03/Grist-Logo.png)' +
          '</p>\n</span>',


        placement: 'auto',
        selector: '.active_cursor',
        showHasModal: false,
        title: 'Markdown image',
        urlState: {
            "colRef": 8,
            "rowId": 8,
            "sectionId": 1
          },
      },
      {
        body: '<span>' +
          '<h1>H1</h1>\n<h2>H2</h2>\n<h3>H3</h3>\n' +
          '</span>',
        placement: 'auto',
        selector: '.active_cursor',
        showHasModal: true,
        title: 'Markdown headings',
        urlState: null,
      },
      {
        body: '<span>' +
          '<ol>\n<li>First item</li>\n<li>Second item</li>\n<li>Third item</li>\n</ol>\n' +
          '</span>',
        placement: 'auto',
        selector: '.active_cursor',
        showHasModal: false,
        title: 'Markdown ordered list',
        urlState: {
            "colRef": 10,
            "rowId": 10,
            "sectionId": 1
          },
      },
      {
        body: '<span>' +
          '<ul>\n<li>First item</li>\n<li>Second item</li>\n<li>Third item</li>\n</ul>\n' +
          '</span>',
        placement: 'auto',
        selector: '.active_cursor',
        showHasModal: true,
        title: 'Markdown unordered list',
        urlState: null,
      },
      {
        body: '<span>' +
          '<blockquote>\n<p>blockquote</p>\n</blockquote>\n' +
          '</span>',
        placement: 'auto',
        selector: '.active_cursor',
        showHasModal: false,
        title: 'Markdown quote',
        urlState: {
            "colRef": 12,
            "rowId": 12,
            "sectionId": 1
          },
      },
      {
        body: '<span>' +
          '<pre><code>{\n  ' +
          '"firstName": "John",\n  "lastName": "Smith",\n  "age": 25\n' +
          '}\n' +
          '</code></pre>\n' +
          '</span>',
        placement: 'auto',
        selector: '.active_cursor',
        showHasModal: true,
        title: 'Markdown code block',
        urlState: null
      },
      {
        body: '<span>' +
          '<p><span class=\"test-text-link _grainXXX_\"><a class=\"_grainXXX_\" rel=\"noopener noreferrer\" href=\"https://www.example.com/\"><span class=\"_grainXXX_ _grainXXX_ _grainXXX_\"><span style=\"mask-image: var(--icon-FieldLink);\" class=\"test-tb-link-icon _grainXXX_\"></span></span></a><span class=\"_grainXXX_\">title</span></span></p>\n' +
          '</span>',
        placement: 'auto',
        selector: '.active_cursor',
        showHasModal: false,
        title: 'Markdown link',
        urlState: {
            "colRef": 14,
            "rowId": 14,
            "sectionId": 1
          },
      },
      {
        body: '<span>' +
          '<p>Do not render HTML only Markdown</p>\n<h1>This is a H1 Title</h1>\n' +
          '<p>Previous SHOULD BE a level 1 Title.</p>\n' +
          '<p>Next should NOT BE a level 1 Title :</p>\n' +
          '&lt;H1&gt;Level 1 title&lt;/H1&gt; \n\n' +
          '<p>The HTML &lt;H1&gt; within this text should not be rendered but the previous Markdown # should</p>\n' +
          '<p>This is another test where the following text SHOULD NOT BE BOLD : &lt;b&gt;should just render the tags without bold &lt;/b&gt;</p>\n' +
          '</span>',
        placement: 'auto',
        selector: '.active_cursor',
        showHasModal: true,
        title: 'Markdown with HTML',
        urlState: null
      }
    ]);
  });

  it('should not show GristDocTour table unless specifically requested', async () => {
    assert.deepEqual(await gu.getPageNames(), ['Table1']);

    // Check that there is no tree item for GristDocTour (we used to show "-").
    assert.lengthOf(await driver.findAll('.test-treeview-label'), 1);

    await gu.loadDoc(`/o/nasa/doc/${doc.id}/p/GristDocTour`);
    await gu.waitForDocToLoad();
    assert.deepEqual(await gu.getPageNames(), ['GristDocTour', 'Table1']);
    assert.lengthOf(await driver.findAll('.test-treeview-label'), 2);
  });

  it('should allow owners to delete tours from the left panel', async () => {
    // Check that Chimpy (the owner) can see the remove tour button.
    assert(await driver.find('.test-tools-remove-doctour').isPresent());
    assert(await driver.find('.test-tools-doctour').isPresent());

    // Chimpy invites Kiwi to view this document as an editor.
    await api.updateDocPermissions(doc.id, {users: {'kiwi@getgrist.com': 'editors'}});

    // Kiwi logs in and loads the document.
    await server.simulateLogin('kiwi', 'kiwi@getgrist.com', 'nasa');
    await gu.loadDoc(`/o/nasa/doc/${doc.id}`);

    // Check that Kiwi sees the onboarding tour.
    assert(await driver.findWait('.test-onboarding-popup', 1000).isPresent());

    // Check that Kiwi can't see the remove tour button.
    assert.isFalse(await driver.find('.test-tools-remove-doctour').isPresent());
    assert(await driver.find('.test-tools-doctour').isPresent());

    // Switch back to Chimpy and remove the tour.
    await driver.find('.test-onboarding-close').click();
    await driver.find('.test-user-icon').click();
    await driver.findContentWait('.test-usermenu-other-email', /chimpy@getgrist.com/, 1000).click();
    await driver.wait(async () => (await gu.getEmail() === 'chimpy@getgrist.com'), 500);
    await driver.findWait('.test-onboarding-close', 1000).click();
    await driver.find('.test-tools-remove-doctour').click();
    await driver.find('.test-modal-confirm').click();
    await gu.waitForServer();

    // Check that the 'Tour of this Document' button is now gone.
    assert.isFalse(await driver.find('.test-tools-doctour').isPresent());

    // Chimpy invites Charon to view this document as an editor.
    await api.updateDocPermissions(doc.id, {users: {'charon@getgrist.com': 'editors'}});

    // Charon logs in and loads the document.
    await server.simulateLogin("Charon", "charon@getgrist.com", "nasa");
    await gu.loadDoc(`/o/nasa/doc/${doc.id}`);

    // Wait a moment after doc loads, and then check that a tour isn't shown.
    await driver.sleep(1000);
    assert.isFalse(await driver.find('.test-onboarding-popup').isPresent());
  });

  async function checkDocTourPresent() {
    // Check the expected message.
     assert.isTrue(await driver.findWait('.test-onboarding-popup', 500)
       .findContent('div', 'General Kenobi!').isPresent());

    // Check that there is only one popup, and no errors.
    assert.lengthOf(await driver.findAll('.test-onboarding-popup'), 1);
    await gu.checkForErrors();

    // Click next once, and check the next expected popup in the same way.
    await driver.find('.test-onboarding-next').click();
    assert.match(await driver.findWait('.test-onboarding-popup', 500).getText(), /no title/);
    assert.lengthOf(await driver.findAll('.test-onboarding-popup'), 1);
    await gu.checkForErrors();
  }

  // Check that there's no tour, not even a welcome tour.
  async function checkTourNotPresent() {
    await driver.sleep(200);    // Wait a bit to be sure.
    assert.isFalse(await driver.find('.test-onboarding-popup').isPresent());
  }

  it('should show doctour for a new anon user, error-free, without welcome tour', async () => {
    // Create a doc with a tour on a personal site, and share it with with everyone as editor.
    const ownerSession = gu.session().user('user1').personalSite;
    await ownerSession.login();
    const docId = (await ownerSession.tempDoc(cleanup, 'doctour.grist', {load: false})).id;
    await ownerSession.createHomeApi().updateDocPermissions(docId, {
      users: {'everyone@getgrist.com': 'editors'}
    });

    // Doc tour normally triggers for a first visit from an anon user
    const anonSession = gu.session().anon.personalSite;
    await anonSession.login({isFirstLogin: undefined});
    await anonSession.loadDoc(`/doc/${docId}/`);
    await checkDocTourPresent();

    // Embedded mode shouldn't show a tour.
    await anonSession.loadDoc(`/doc/${docId}/?embed=1`);
    await checkTourNotPresent();

    // Reload the doc without embedding. We didn't dismiss the tour, so it should show up again.
    await anonSession.loadDoc(`/doc/${docId}/`);
    await checkDocTourPresent();

    // Dismiss the tour.
    await driver.find('.test-onboarding-close').click();
    await checkTourNotPresent();

    // Reload the page, the tour should stay dismissed.
    await driver.navigate().refresh();
    await gu.waitForDocToLoad();
    await checkTourNotPresent();

    // Trigger the tour manually.
    await driver.find('.test-tools-doctour').click();
    await checkDocTourPresent();
  });

  it.skip('should not show doctour if opening an anchor link encoded with rr', async () => {
    // Create a doc with a tour on a personal site.
    const session = await gu.session().user('user1').personalSite.login({showTips: true});
    const docId = (await session.tempDoc(cleanup, 'doctour.grist', {load: false})).id;

    // Load the doc with an anchor link containing an easter egg ("rr" instead of "r").
    await session.loadDoc(`/doc/${docId}/doctour/p/1#a1.s1.rr1.c2`);

    // Check that the doc tour isn't shown on doc load.
    await checkTourNotPresent();

    // Dismiss the tip about anchor links, and check that the easter egg is present.
    await gu.dismissBehavioralPrompts();
    await driver.wait(async () =>
      // Loading the YouTube API from tests can sometimes be slow.
      await driver.find('.test-gristdoc-stop-rick-rowing').isPresent(), 15000);
    await gu.assertIsRickRowing(true);

    // Stop playing the easter egg.
    await driver.find('.test-gristdoc-stop-rick-rowing').click();
    await gu.assertIsRickRowing(false);

    // Check that tours can still be started manually.
    await driver.find('.test-tools-doctour').click();
    await checkDocTourPresent();
  });

  it('should not show doctour if opening an anchor link', async () => {
    // Create a doc with a tour on a personal site.
    const session = await gu.session().user('user1').personalSite.login({showTips: true});
    const docId = (await session.tempDoc(cleanup, 'doctour.grist', {load: false})).id;

    // Load the doc with an anchor link.
    await session.loadDoc(`/doc/${docId}/doctour/p/1#a1.s1.r1.c2`);

    // Check that the doc tour isn't shown on doc load.
    await checkTourNotPresent();

    // Check that tours can still be started manually.
    await driver.find('.test-tools-doctour').click();
    await checkDocTourPresent();
  });
});
