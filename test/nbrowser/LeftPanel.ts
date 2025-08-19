import {assert, driver} from 'mocha-webdriver';
import * as gu from 'test/nbrowser/gristUtils';
import {setupTestSuite} from 'test/nbrowser/testUtils';

describe('LeftPanel', function() {
  this.timeout(20000);
  const cleanup = setupTestSuite();
  let mainSession: gu.Session;
  let docId: string;


  before(async function() {
    mainSession = await gu.session().teamSite.user('user1').login();
    docId = await mainSession.tempNewDoc(cleanup, 'LeftPanel.grist', {load: false});
  });

  afterEach(() => gu.checkForErrors());

  it('should not update session storage when auto-expanding', async function() {
    await mainSession.loadDoc(`/doc/${docId}/p/1`);

    // make sure panel is closed
    await gu.toggleSidePanel('left', 'close');

    // move mouse in and wait for full expansion
    await driver.find('.test-left-panel').mouseMove();
    await driver.sleep(500 + 450);

    // check panel is open
    assert.equal(await gu.isSidePanelOpen('left'), true);

    // move away the cursor to prevent auto-expanding after reload
    await driver.find('.test-top-header').mouseMove();

    // refresh
    await driver.navigate().refresh();
    await gu.waitForDocToLoad();

    // check panel is closed
    assert.equal(await gu.isSidePanelOpen('left'), false);
  });

  it('should not show "Templates" button if templates org is unset', async function() {
    await gu.toggleSidePanel('left', 'open');
    assert.isFalse(await driver.find('.test-dm-templates-page').isPresent());
  });
});
