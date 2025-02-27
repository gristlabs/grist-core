import {assert, driver, Key, WebElement} from 'mocha-webdriver';
import {server, setupTestSuite} from './testUtils';

describe('UserManager', () => {
  setupTestSuite();

  before(async function() {
    this.timeout(60000);      // Set a longer default timeout.
    await driver.get(`${server.getHost()}/UserManager`);
  });

  async function getMemberEmail(member: WebElement) {
    // Try getting the email first; if we fail to find it, try getting the name
    // (whose value may be an email).
    try {
      return await member.find('.test-um-member-email').getText();
    } catch {
      return await member.find('.test-um-member-name').getText();
    }
  }

  async function getRenderedMembers(): Promise<Array<[string, string|null]>> {
    const members = await driver.findAll('.test-um-member');
    return await Promise.all(members.map(m => Promise.all([
      getMemberEmail(m),
      getMemberRole(m)
    ])));
  }

  async function getMemberRole(memberElem: WebElement): Promise<string|null> {
    const roleElem = memberElem.find('.test-um-member-role');
    const exists = await roleElem.isPresent();
    return exists ? roleElem.getText() : null;
  }

  it('should render all emails and roles initially', async function() {
    assert.deepEqual(await getRenderedMembers(), [
      ["foo@example.com", "Owner"],
      ["bar@example.com", "Editor"],
      ["team@example.com", "Viewer"],
      ["guest@example.com", "Viewer"],
    ]);
    assert.deepEqual(JSON.parse(await driver.find('.test-result').getText()), {});
  });

  it('should reflect role changes', async function() {
    await driver.find('.test-um-member .test-um-member-role').doClick();
    await driver.findContent('.test-um-role-option', /Editor/).doClick();
    assert.deepEqual(await getRenderedMembers(), [
      ["foo@example.com", "Editor"],
      ["bar@example.com", "Editor"],
      ["team@example.com", "Viewer"],
      ["guest@example.com", "Viewer"],
    ]);

    // Save and check output.
    await driver.find('.test-save').click();
    assert.deepEqual(JSON.parse(await driver.find('.test-result').getText()), {
      users: {"foo@example.com": "editors"}
    });
    await driver.find('.test-reset').click();
  });

  it('should allow adding emails', async function() {
    await driver.find('.test-um-member-new input').sendKeys('bob@bob.tail', Key.ENTER);
    await driver.find('.test-um-member-new input').sendKeys('alice@a.com', Key.ENTER);
    await driver.find('.test-um-member-new input').sendKeys('eve@a.com', Key.ENTER);
    await driver.findContent('.test-um-member', /eve@a\.com/).find('.test-um-member-role').doClick();
    await driver.findContent('.test-um-role-option', /Editor/).doClick();
    await driver.findContent('.test-um-member', /bob@bob\.tail/).find('.test-um-member-role').doClick();
    await driver.findContent('.test-um-role-option', /Editor/).doClick();

    assert.deepEqual(await getRenderedMembers(), [
      ["foo@example.com", "Owner"],
      ["bar@example.com", "Editor"],
      ["team@example.com", "Viewer"],
      ["guest@example.com", "Viewer"],
      ["bob@bob.tail", "Editor"],
      ["alice@a.com", "Viewer"],
      ["eve@a.com", "Editor"],
    ]);

    // Save and check output.
    await driver.find('.test-save').click();
    assert.deepEqual(JSON.parse(await driver.find('.test-result').getText()), {
      users: {
        "bob@bob.tail": "editors",
        "alice@a.com": "viewers",
        "eve@a.com": "editors",
      }
    });
    await driver.find('.test-reset').click();
  });

  it('should only suggest team members in autocomplete', async function() {
    await driver.find('.test-um-member-new input').sendKeys('t');
    assert.deepEqual(
      await driver.findAll('.test-acselect-dropdown .test-um-member-name', (el) => el.getText()),
      ['Team Member'],
    );

    await driver.find('.test-um-member-new input').doClear().sendKeys('.com');
    assert.deepEqual(
      await driver.findAll('.test-acselect-dropdown .test-um-member-name', (el) => el.getText()),
      ['Team Member'],
    );
  });

  it('should allow deleting newly-added emails', async function() {
    await driver.find('.test-um-member-new input').doClear().sendKeys('bob@bob.tail', Key.ENTER);
    await driver.findContent('.test-um-member', /bar@example\.com/).find('.test-um-member-delete').doClick();
    await driver.findContent('.test-um-member', /bob@bob\.tail/).find('.test-um-member-delete').doClick();

    assert.deepEqual(await getRenderedMembers(), [
      ["foo@example.com", "Owner"],
      ["bar@example.com", null],
      ["team@example.com", "Viewer"],
      ["guest@example.com", "Viewer"],
    ]);

    // Save and check output.
    await driver.find('.test-save').click();
    assert.deepEqual(JSON.parse(await driver.find('.test-result').getText()), {
      users: {"bar@example.com": null}
    });
    await driver.find('.test-reset').click();
  });

  it('should allow resetting', async function() {
    await driver.find('.test-um-member-new input').sendKeys('alice@bobtail.com', Key.ENTER);
    await driver.findContent('.test-um-member', /foo@example\.com/).find('.test-um-member-delete').doClick();
    await driver.findContent('.test-um-member', /bar@example\.com/).find('.test-um-member-role').doClick();
    await driver.findContent('.test-um-role-option', /Owner/).doClick();
    await driver.findContent('.test-um-member', /alice@bobtail\.com/).find('.test-um-member-role').doClick();
    await driver.findContent('.test-um-role-option', /Owner/).doClick();

    assert.deepEqual(await getRenderedMembers(), [
      ["foo@example.com", null],
      ["bar@example.com", "Owner"],
      ["team@example.com", "Viewer"],
      ["guest@example.com", "Viewer"],
      ["alice@bobtail.com", "Owner"],
    ]);

    // Output is unchanged at this point.
    assert.deepEqual(JSON.parse(await driver.find('.test-result').getText()), {});

    // Click the Reset button.
    await driver.find('.test-reset').doClick();

    // Check that everything is as at the start now.
    assert.deepEqual(await getRenderedMembers(), [
      ["foo@example.com", "Owner"],
      ["bar@example.com", "Editor"],
      ["team@example.com", "Viewer"],
      ["guest@example.com", "Viewer"],
    ]);
    assert.deepEqual(JSON.parse(await driver.find('.test-result').getText()), {});
  });

  it('should show validation error for duplicate email', async function() {
    await driver.find('.test-reset').click();

    // Entering an existing email produces a validation error.
    await driver.find('.test-um-member-new input').sendKeys('foo@example.com', Key.ENTER);
    assert.match(await driver.find('.test-um-member-new input').getAttribute('validationMessage'),
      /already in the list/);

    // Entering a new email does not.
    await driver.find('.test-um-member-new input').doClear().sendKeys('foo2@example.com', Key.ENTER);
    assert.equal(await driver.find('.test-um-member-new input').getAttribute('validationMessage'), '');
    assert.deepEqual(await getRenderedMembers(), [
      ["foo@example.com", "Owner"],
      ["bar@example.com", "Editor"],
      ["team@example.com", "Viewer"],
      ["guest@example.com", "Viewer"],
      ["foo2@example.com", "Viewer"],
    ]);

    // A newly-added email IS considered "existing".
    await driver.find('.test-um-member-new input').doClear().sendKeys('foo2@example.com', Key.ENTER);
    assert.match(await driver.find('.test-um-member-new input').getAttribute('validationMessage'),
      /already in the list/);

    // Without clearing the email, remove the conflicting member and try again.
    await driver.findContent('.test-um-member', /foo2@example\.com/).find('.test-um-member-delete').doClick();
    await driver.find('.test-um-member-new input').doClick().sendKeys(Key.ENTER);
    assert.equal(await driver.find('.test-um-member-new input').getAttribute('validationMessage'), '');
    assert.deepEqual(await getRenderedMembers(), [
      ["foo@example.com", "Owner"],
      ["bar@example.com", "Editor"],
      ["team@example.com", "Viewer"],
      ["guest@example.com", "Viewer"],
      ["foo2@example.com", "Viewer"],
    ]);
  });
});
