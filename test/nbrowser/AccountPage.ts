import { assert, driver } from "mocha-webdriver";
import { server, setupTestSuite } from "test/nbrowser/testUtils";

describe("AccountPage", function() {
  setupTestSuite();

  it("should apply Gravatar image", async function() {
    // Login as chimpy
    await server.simulateLogin("Chimpy", "chimpy@getgrist.com", "nasa");

    // Go to account page
    await driver.get(`${server.getHost()}/account`);

    // Wait for page to load
    await driver.findWait(".test-account-page-user-picture", 3000);

    // Initially picture should be null (no image, just initials)
    const pictureElement = await driver.find(".test-account-page-user-picture");
    // Check that there's no img tag initially
    const images = await pictureElement.findAll("img");
    assert.equal(images.length, 0);

    // Click apply Gravatar button
    await driver.find(".test-account-page-apply-gravatar").click();

    // Wait for loading to finish (button should be disabled during apply)
    await driver.wait(async () => {
      const button = await driver.find(".test-account-page-apply-gravatar");
      return !(await button.isEnabled());
    }, 5000);

    // Wait for button to be enabled again
    await driver.wait(async () => {
      const button = await driver.find(".test-account-page-apply-gravatar");
      return await button.isEnabled();
    }, 5000);

    // Now check that picture is updated (img tag present)
    await driver.wait(async () => {
      const images = await pictureElement.findAll("img");
      return images.length > 0;
    }, 3000);

    const img = await pictureElement.find("img");
    const src = await img.getAttribute("src");
    assert.match(src, /^https:\/\/www\.gravatar\.com\/avatar\//);
  });

  it("should remove Gravatar image", async function() {
    // Assuming previous test ran, picture should have gravatar
    await server.simulateLogin("Chimpy", "chimpy@getgrist.com", "nasa");
    await driver.get(`${server.getHost()}/account`);
    await driver.findWait(".test-account-page-user-picture", 3000);

    // Click remove Gravatar button
    await driver.find(".test-account-page-remove-gravatar").click();

    // Wait for loading to finish
    await driver.wait(async () => {
      const button = await driver.find(".test-account-page-remove-gravatar");
      return await button.isEnabled();
    }, 5000);

    // Check that picture is removed (no img tag)
    const pictureElement = await driver.find(".test-account-page-user-picture");
    const images = await pictureElement.findAll("img");
    assert.equal(images.length, 0);
  });
});