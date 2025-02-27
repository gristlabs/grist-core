import { assert, driver, stackWrapFunc } from "mocha-webdriver";
import { server, setupTestSuite } from "./testUtils";

const getLogs = stackWrapFunc(() => driver.findAll('.test-logs', (e) => e.getText()));

describe('OnBoardingPopups', function() {
  setupTestSuite();

  before(async function() {
    this.timeout(60000);
    await driver.get(`${server.getHost()}/OnBoardingPopups`);
  });

  it('should work correctly', async () => {
    // check there are no logs
    assert.deepEqual(await getLogs(), []);

    // check the popup is not there
    assert.equal(await driver.find('.test-onboarding-popup').isPresent(), false);

    // click start button
    await driver.findContent('button', /Start/).click();

    // check the popup is there
    assert.equal(await driver.find('.test-onboarding-popup').isPresent(), true);

    // check the content is correct
    assert.match(await driver.find('.test-onboarding-popup').getText(), /add new/);

    // click next
    await driver.find('.test-onboarding-next').click();

    // check the content changed
    assert.match(await driver.find('.test-onboarding-popup').getText(), /Export/);

    // click close
    await driver.find('.test-onboarding-close').click();

    // check the popup has disappeared
    assert.equal(await driver.find('.test-onboarding-popup').isPresent(), false);

    // check the finish is logged
    assert.deepEqual(await getLogs(), ['On Boarding FINISHED!']);

    // Clear logs
    await driver.findContent('button', /Reset logs/).click();
  });

  it('should disable next button on last message', async () => {
    // click start button
    await driver.findContent('button', /Start/).click();

    // click next till the end
    for (let i = 0; i < 4; i++) {
      const button = await driver.find('.test-onboarding-next');
      assert.equal(await button.getText(), 'Next');
      await button.click();
    }

    // check the content is correct
    assert.match(await driver.find('.test-onboarding-popup').getText(), /Great tools/);

    // check the next button says 'Finish'
    const button = await driver.find('.test-onboarding-next');
    assert.equal(await button.getText(), 'Finish');

    // click the finish button
    await button.click();

    // check finish has been logged
    assert.deepEqual(await getLogs(), ['On Boarding FINISHED!']);

    // clear logs
    await driver.findContent('button', /Reset logs/).click();
  });

  it('should add an overlay to prevent from using the rest of the UI', async () => {
    // check logs are empty
    assert.deepEqual(await getLogs(), []);

    // Click Add New and check it added new logs
    await driver.findContent('button', /Add New/).click();
    assert.deepEqual(await getLogs(), ['CLICKED Add New!']);

    // start on boarding
    await driver.findContent('button', /Start/).click();

    // check the popup is present
    assert.equal(await driver.find('.test-onboarding-popup').isPresent(), true);

    // try click Add New
    try {
      await driver.findContent('button', /Add New/).click();
    } catch(e) {
      assert.match(e.message, /element click intercepted/);
    }

    // check nore more logs added
    assert.deepEqual(await getLogs(), ['CLICKED Add New!']);

    // click close
    await driver.find('.test-onboarding-close').click();

    // clear logs
    await driver.findContent('button', /Reset logs/).click();
  });
});
