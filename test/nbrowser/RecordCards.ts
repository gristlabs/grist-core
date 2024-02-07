import {UserAPI} from 'app/common/UserAPI';
import {assert, driver, Key} from 'mocha-webdriver';
import * as gu from 'test/nbrowser/gristUtils';
import {setupTestSuite} from 'test/nbrowser/testUtils';

describe('RecordCards', function() {
  this.timeout(30000);
  let api: UserAPI;
  let docId: string;
  let session: gu.Session;
  const cleanup = setupTestSuite();

  before(async function() {
    session = await gu.session().login();
    docId = (await session.tempDoc(cleanup, 'World-v39.grist')).id;
    api = session.createHomeApi();
    await gu.openPage('Country');
  });

  afterEach(() => gu.checkForErrors());

  describe('RowContextMenu', function() {
    it('opens popup when keyboard shortcut is pressed', async function() {
      await gu.sendKeys(Key.SPACE);
      assert.isTrue(await driver.findWait('.test-record-card-popup-overlay', 100).isDisplayed());
      assert.equal(
        await driver.find('.test-record-card-popup-wrapper .test-widget-title-text').getText(),
        'COUNTRY Card'
      );
      assert.equal(await gu.getCardCell('Code').getText(), 'ALB');
      assert.isFalse(await driver.find('.grist-single-record__menu').isPresent());
      await gu.sendKeys(Key.ESCAPE);
    });

    it('opens popup when menu item is clicked', async function() {
      await (await gu.openRowMenu(2)).findContent('li', /View as card/).click();
      assert.isTrue(await driver.findWait('.test-record-card-popup-overlay', 100).isDisplayed());
      assert.equal(
        await driver.find('.test-record-card-popup-wrapper .test-widget-title-text').getText(),
        'COUNTRY Card'
      );
      assert.equal(await gu.getCardCell('Code').getText(), 'AND');
      await gu.sendKeys(Key.ESCAPE);
    });

    it('closes popup when record is deleted', async function() {
      await api.applyUserActions(docId, [
        ['RemoveRecord', 'Country', 1]
      ]);
      await gu.waitToPass(async () => {
        assert.isFalse(await driver.find('.test-record-card-popup-overlay').isPresent());
      }, 2000);

      await (await gu.openRowMenu(1)).findContent('li', /View as card/).click();
      assert.isTrue(await driver.findWait('.test-record-card-popup-overlay', 100).isDisplayed());
      await gu.sendKeys(Key.chord(await gu.modKey(), Key.DELETE));
      await driver.find('.test-confirm-save').click();
      await gu.waitForServer();
      assert.isFalse(await driver.find('.test-record-card-popup-overlay').isPresent());
    });

    it('hides option to open popup if more than 1 row is selected', async function() {
      await gu.sendKeys(Key.chord(Key.SHIFT, Key.DOWN));
      assert.isFalse(await (await gu.openRowMenu(1)).findContent('li', /View as card/).isPresent());
      await gu.sendKeys(Key.ESCAPE, Key.SPACE);
      assert.isFalse(await driver.find('.test-record-card-popup-overlay').isPresent());
    });

    it('disables option to open popup in "add new" row', async function() {
      await gu.sendKeys(Key.chord(await gu.modKey(), Key.DOWN));
      assert.isTrue(await (await gu.openRowMenu(120)).findContent('li.disabled', /View as card/).isPresent());
      await gu.sendKeys(Key.ESCAPE, Key.SPACE);
      assert.isFalse(await driver.find('.test-record-card-popup-overlay').isPresent());
    });
  });

  describe('Reference', function() {
    before(async function() {
      await gu.openPage('CountryLanguage');
    });

    it('opens popup when reference icon is clicked', async function() {
      await gu.getCell(0, 4).find('.test-ref-link-icon').click();
      assert.isTrue(await driver.findWait('.test-record-card-popup-overlay', 100).isDisplayed());
      assert.equal(
        await driver.find('.test-record-card-popup-wrapper .test-widget-title-text').getText(),
        'COUNTRY Card'
      );
      assert.equal(await gu.getCardCell('Code').getText(), 'AFG');
      assert.isFalse(await driver.find('.grist-single-record__menu').isPresent());
      await gu.sendKeys(Key.ESCAPE);
    });

    it('updates popup when reference icon is clicked within Record Card popup', async function() {
      await gu.getCell(0, 4).find('.test-ref-text').click();
      await gu.sendKeys(Key.SPACE);
      assert.isTrue(await driver.findWait('.test-record-card-popup-overlay', 100).isDisplayed());
      assert.equal(
        await driver.find('.test-record-card-popup-wrapper .test-widget-title-text').getText(),
        'COUNTRYLANGUAGE Card'
      );
      assert.equal(await gu.getCardCell('Country').getText(), 'AFG');
      await gu.getCardCell('Country').find('.test-ref-link-icon').click();
      assert.equal(
        await driver.find('.test-record-card-popup-wrapper .test-widget-title-text').getText(),
        'COUNTRY Card'
      );
      assert.equal(await gu.getCardCell('Code').getText(), 'AFG');
      await gu.sendKeys(Key.ESCAPE);
    });

    it('does not open popup if cell is empty', async function() {
      await gu.getCell(0, 4).find('.test-ref-text').click();
      await driver.sendKeys(Key.DELETE);
      await gu.waitForServer();
      await gu.getCell(0, 4).find('.test-ref-link-icon').click();
      assert.isFalse(await driver.find('.test-record-card-popup-overlay').isPresent());
      await gu.undo();
    });

    it('does not open popup in "add new" row', async function() {
      await gu.sendKeys(Key.chord(await gu.modKey(), Key.DOWN));
      await gu.getCell(0, 747).find('.test-ref-link-icon').click();
      assert.isFalse(await driver.find('.test-record-card-popup-overlay').isPresent());
    });
  });

  describe('ReferenceList', function() {
    before(async function() {
      await gu.sendKeys(Key.chord(await gu.modKey(), Key.UP));
      await gu.setType('Reference List', {apply: true});
    });

    it('opens popup when reference icon is clicked', async function() {
      await gu.getCell(0, 4).find('.test-ref-list-link-icon').click();
      assert.isTrue(await driver.findWait('.test-record-card-popup-overlay', 100).isDisplayed());
      assert.equal(
        await driver.find('.test-record-card-popup-wrapper .test-widget-title-text').getText(),
        'COUNTRY Card'
      );
      assert.equal(await gu.getCardCell('Code').getText(), 'AFG');
      assert.isFalse(await driver.find('.grist-single-record__menu').isPresent());
      await gu.sendKeys(Key.ESCAPE);
    });

    it('updates popup when reference icon is clicked within Record Card popup', async function() {
      await gu.getCell(0, 4).click();
      await gu.sendKeys(Key.SPACE);
      assert.isTrue(await driver.findWait('.test-record-card-popup-overlay', 100).isDisplayed());
      assert.equal(
        await driver.find('.test-record-card-popup-wrapper .test-widget-title-text').getText(),
        'COUNTRYLANGUAGE Card'
      );
      assert.equal(await gu.getCardCell('Country').getText(), 'AFG');
      await gu.getCardCell('Country').find('.test-ref-list-link-icon').click();
      assert.equal(
        await driver.find('.test-record-card-popup-wrapper .test-widget-title-text').getText(),
        'COUNTRY Card'
      );
      assert.equal(await gu.getCardCell('Code').getText(), 'AFG');
      await gu.sendKeys(Key.ESCAPE);
    });
  });

  describe('RawData', function() {
    before(async function() {
      await driver.find('.test-tools-raw').click();
      await driver.findWait('.test-raw-data-list', 2000);
      await gu.waitForServer();
    });

    it('opens popup when reference icon is clicked', async function() {
      await driver.findContent('.test-raw-data-table-title', 'City').click();
      await gu.waitForServer();
      await gu.getCell(1, 5).find('.test-ref-link-icon').click();
      assert.equal(
        await driver.find('.test-raw-data-overlay .test-widget-title-text').getText(),
        'COUNTRY Card'
      );
      assert.equal(await gu.getCardCell('Code').getText(), 'NLD');
    });
  });
});
