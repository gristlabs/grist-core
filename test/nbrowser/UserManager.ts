import {fromPairs} from 'lodash';
import { assert, driver, Key, stackWrapFunc, WebElementPromise} from 'mocha-webdriver';
import * as path from 'path';
import * as gu from 'test/nbrowser/gristUtils';
import {server, setupTestSuite} from 'test/nbrowser/testUtils';

const {editOrgAcls, saveAcls} = gu;

// Opens the doc acl edit menu for the given workspace.
const editWsAcls = stackWrapFunc(async function(wsName: string): Promise<void> {
  // To prevent a common flakiness problem, wait for a potentially open modal dialog
  // to close before attempting to open the account menu.
  await driver.wait(async () => !(await driver.find('.test-modal-dialog').isPresent()), 3000);
  await gu.openWsDropdown(wsName);
  await driver.findWait('.test-dm-workspace-access', 1000).click();
  await driver.wait(() => driver.find('.test-um-members').isPresent(), 3000);
});

// Opens the doc acl edit menu for the given doc.
const editDocAcls = stackWrapFunc(async function(docName: string): Promise<void> {
  // To prevent a common flakiness problem, wait for a potentially open modal dialog
  // to close before attempting to open the account menu.
  await driver.wait(async () => !(await driver.find('.test-modal-dialog').isPresent()), 3000);
  await gu.openDocDropdown(docName);
  await driver.findWait('.test-dm-doc-access', 1000).click();
  await driver.wait(() => driver.find('.test-um-members').isPresent(), 3000);
});

// Opens the doc acl edit menu for the currently open doc via the Share menu.
const editDocAclsShareMenu = stackWrapFunc(async function(): Promise<void> {
  await driver.findWait('.test-tb-share', 2000).doClick();
  await driver.findContentWait('.test-tb-share-option', /(Access Details)|(Manage Users)/, 1000).doClick();
  await driver.wait(() => driver.find('.test-um-members').isPresent(), 3000);
});

// Asserts that the user's role in the open acl edit menu is as given. If the given roleLabel is undefined,
// asserts that the user is not shown in the menu or was deleted.
async function assertRole(name: string, roleLabel: string|null, inherited: boolean|null) {
  const row = driver.findContent('.test-um-member', new RegExp(`${name}@getgrist.com`));
  if (!roleLabel) {
    assert.isTrue(!(await row.isPresent()) || await row.find(".test-um-member-undo").isPresent());
  }
  else {
    assert.equal(await row.find(`.test-um-member-role`).getText(), roleLabel);
    if (inherited !== null) {
      await row.find(`.test-um-member-role`).click();
      await gu.findOpenMenu();
      const text = await driver.findContent('.test-um-role-option', roleLabel).getText();
      assert.equal(text, inherited ? `${roleLabel} (inherited)` : roleLabel);
      // Click away to close the menu
      await driver.find(`.test-um-members`).click();
    }
  }
}

// Asserts the current user's own access details in the Access Details dialog.
const assertAccessDetails = stackWrapFunc(async function(name: string, role: string, annotation?: string) {
  const row = driver.find('.test-um-member');
  assert.equal(await row.find('.test-um-member-name').getText(), name);
  assert.equal(await row.find('.test-um-member-role').getText(), role);
  if (annotation) {
    assert.equal(await row.find('.test-um-member-annotation').getText(), annotation);
  }
  else {
    assert.isFalse(await row.find('.test-um-member-annotation').isPresent());
  }
});

// Asserts that the maxInheritedRole dropdown in the open acl edit menu is as given.
const assertMaxInheritedRole = stackWrapFunc(async function(inheritLabel: string): Promise<void> {
  assert.equal(await driver.find(`.test-um-max-inherited-role`).getText(), inheritLabel);
});

describe('UserManager', function() {
  this.timeout(20000);
  gu.bigScreen();
  const cleanup = setupTestSuite();

  before(async function() {
    // Initially teamSite is created with users user1 (gristoid+chimpy@) and support@ as owners,
    // but some tests call resetSite(), leaving it owned only by user1. This test assumes that
    // support@ is among owners, so we ensure that by resetting and adding support@ manually.
    const session = await gu.session().teamSite.user('user1').login();
    await session.resetSite();
    await session.createHomeApi().updateOrgPermissions(session.settings.orgDomain, {
      users: {'support@getgrist.com': 'owners'},
    });
  });

  it('allows updating org permissions', async () => {
    // Simulate Chimpy login.
    await server.simulateLogin("Chimpy", "chimpy@getgrist.com", "fish");
    await driver.get(`${server.getHost()}/o/fish`);
    await gu.waitForDocMenuToLoad();

    assert.equal(await driver.findContent('.test-dm-doc-name', /Anch/).getText(), 'Anchovy');
    assert.equal(await driver.findContent('.test-dm-doc-name', /Time/).isPresent(), false);
    assert.equal(await gu.getEmail(), 'chimpy@getgrist.com');

    // Open the UserManager
    await editOrgAcls();

    // Public access option should not be included for orgs (except with GRIST_SUPPORT_ANON=true,
    // which is only set in single-org setup, and not set for these tests).
    assert.equal(await driver.find('.test-um-public-access').isPresent(), false);

    // Open Access Rules should not be shown (a previous bug caused this to always be shown).
    assert.equal(await driver.find('.test-um-open-access-rules').isPresent(), false);

    // Remove Charon, save and check that it persists
    await driver.findContent('.test-um-member', /charon@getgrist.com/).find('.test-um-member-delete').click();
    await saveAcls();
    await editOrgAcls();
    const emails = await driver.findAll('.test-um-member-email');
    assert.equal(emails.length, 2);
    await driver.find('.test-um-cancel').click();

    // Check that Charon cannot view Fish.
    await server.simulateLogin("Charon", "charon@getgrist.com", "fish");
    await driver.get(`${server.getHost()}/o/fish`);
    await driver.findContentWait('.test-error-header', /Access denied/, 3000);
    assert.match(await driver.find('.test-error-header').getText(), /Access denied/);

    // Simulate Chimpy login.
    await server.simulateLogin("Chimpy", "chimpy@getgrist.com", "fish");
    await driver.get(`${server.getHost()}/o/fish`);
    await gu.waitForDocMenuToLoad();

    // Add Charon back as an editor.
    await editOrgAcls();
    await driver.find('.test-um-member-new').find('input').click();
    await driver.sendKeys('charon@getgrist.com', Key.ENTER);
    await driver.findContent('.test-um-member', /charon@getgrist.com/).find('.test-um-member-role').click();
    await driver.findContentWait('.test-um-role-option', /Editor/, 100).click();
    await saveAcls();

    // Check that Charon can view Fish, but can't edit org permissions.
    await server.simulateLogin("Charon", "charon@getgrist.com", "fish");
    await driver.get(`${server.getHost()}/o/fish`);
    await gu.waitForDocMenuToLoad();
    await driver.find('.test-user-icon').click();
    await canEditAccess(driver.findWait('.test-dm-org-access', 1000), false);

    // Charon should be able to remove themselves.
    await driver.sendKeys(Key.ESCAPE);
    await editOrgAcls();
    assert.equal(await driver.find('.test-um-member-new').find('input').isPresent(), false);
    await findMember('charon@getgrist.com').find('.test-um-member-delete').click();
    await saveAcls(true);
    await driver.get(`${server.getHost()}/o/fish`);
    await driver.findContentWait('.test-error-header', /Access denied/, 3000);

    // Simulate Chimpy login.
    await server.simulateLogin("Chimpy", "chimpy@getgrist.com", "fish");
    await driver.get(`${server.getHost()}/o/fish`);
    await gu.waitForDocMenuToLoad();

    // Add Charon back as an owner.
    await editOrgAcls();
    await driver.find('.test-um-member-new').find('input').click();
    await driver.sendKeys('charon@getgrist.com', Key.ENTER);
    await driver.findContentWait('.test-um-member', /charon@getgrist.com/, 1000).find('.test-um-member-role').click();
    await gu.findOpenMenu();
    await driver.findContentWait('.test-um-role-option', /Owner/, 100).click();
    await saveAcls();

    // Check that Charon can view Fish and edit org permissions.
    await server.simulateLogin("Charon", "charon@getgrist.com", "fish");
    await driver.get(`${server.getHost()}/o/fish`);
    await gu.waitForDocMenuToLoad();
    await driver.find('.test-user-icon').click();
    await canEditAccess(driver.findWait('.test-dm-org-access', 1000), true);
  });

  it('allows updating workspace permissions', async () => {
    // Simulate Chimpy login and open Small workspace ACL menu.
    await server.simulateLogin("Chimpy", "chimpy@getgrist.com", "fish");
    await driver.get(`${server.getHost()}/o/fish`);
    await gu.waitForDocMenuToLoad();

    // Open workspace options and assert that the initial state is as expected.
    await editWsAcls('Small');
    await assertMaxInheritedRole('In full');
    await assertRole('chimpy', 'Owner', null);
    await assertRole('kiwi', 'Editor', true);
    await assertRole('charon', 'Owner', true);

    // Public access option should not be included for workspaces (except with GRIST_SUPPORT_ANON=true,
    // which is only set in single-org setup, and not set for these tests).
    assert.isFalse(await driver.find('.test-um-public-access').isPresent());

    // Open Access Rules should not be shown (a previous bug caused this to always be shown).
    assert.isFalse(await driver.find('.test-um-open-access-rules').isPresent());

    // Lower max inherited role to Viewers and check that roles and inheritance tags are as expected.
    // The active user Chimpy's role should remain owner.
    // Kiwi and Charon should become an inherited viewers.
    await driver.find('.test-um-max-inherited-role').click();
    await gu.findOpenMenu();
    await driver.findContent('.test-um-role-option', /View only/).click();
    await assertRole('chimpy', 'Owner', null);
    await assertRole('kiwi', 'Viewer', true);
    await assertRole('charon', 'Viewer', true);

    // Save new max inherited role and check that it persists.
    await saveAcls();
    await editWsAcls('Small');
    await assertMaxInheritedRole('View only');
    await driver.find('.test-um-cancel').click();

    // Simulate Charon login and assert that Charon can still see the workspace, but cannot
    // edit it.
    await server.simulateLogin("Charon", "charon@getgrist.com", "fish");
    await driver.get(`${server.getHost()}/o/fish`);
    await gu.waitForDocMenuToLoad();
    await gu.openWsDropdown('Small');
    assert(await driver.find('.test-dm-rename-workspace').matches('.disabled'));
    assert(await driver.find('.test-dm-delete-workspace').matches('.disabled'));
    await canEditAccess(driver.find('.test-dm-workspace-access'), false);

    // Log in with Chimpy once again.
    await server.simulateLogin("Chimpy", "chimpy@getgrist.com", "fish");
    await driver.get(`${server.getHost()}/o/fish`);
    await gu.waitForDocMenuToLoad();

    // Increase Charon's role to above the inherited role and check that the inherited tag is
    // no longer visible.
    await editWsAcls('Small');
    await driver.findContent('.test-um-member', /charon@getgrist.com/).find('.test-um-member-role').click();
    await gu.findOpenMenu();
    await driver.findContent('.test-um-role-option', /Owner/).click();
    await saveAcls();
    await editWsAcls('Small');
    await assertRole('chimpy', 'Owner', false);
    await assertRole('charon', 'Owner', null);
    await assertRole('kiwi', 'Viewer', true);
    await driver.find('.test-um-cancel').click();

    // Simulate log in with Charon and assert that Charon can now edit access to the doc.
    await server.simulateLogin("Charon", "charon@getgrist.com", "fish");
    await driver.get(`${server.getHost()}/o/fish`);
    await gu.waitForDocMenuToLoad();
    await editWsAcls('Small');

    // Lower max inherited role to none (as Charon) and check that Kiwi's displayed inherited
    // role has lowered to match. Note that the inherited tag is not displayed on users
    // with no access. Charon's role should be unchanged.
    await driver.find('.test-um-max-inherited-role').click();
    await gu.findOpenMenu();
    await driver.findContent('.test-um-role-option', /None/).click();
    await assertRole('chimpy', 'Owner', false);
    await assertRole('kiwi', null, null);
    await assertRole('charon', 'Owner', false);

    // Save new max inherited role and check that it persists.
    await saveAcls();
    await editWsAcls('Small');
    await assertMaxInheritedRole('None');
    await driver.find('.test-um-cancel').click();

    // Simulate log in with Kiwi and assert the workspace is not visible.
    await server.simulateLogin("Kiwi", "kiwi@getgrist.com", "fish");
    await driver.get(`${server.getHost()}/o/fish`);
    await gu.waitForDocMenuToLoad();
    assert.equal(await driver.findContent('.test-dm-workspace', /Small/).isPresent(), false);

    // Log in with Chimpy again and return roles to the initial state.
    await server.simulateLogin("Chimpy", "chimpy@getgrist.com", "fish");
    await driver.get(`${server.getHost()}/o/fish`);
    await gu.waitForDocMenuToLoad();
    await editWsAcls('Small');
    await driver.find('.test-um-max-inherited-role').click();
    await gu.findOpenMenu();
    await driver.findContent('.test-um-role-option', /In full/).click();
    await driver.findContent('.test-um-member', /kiwi@getgrist.com/).find('.test-um-member-role').click();
    await gu.findOpenMenu();
    await driver.findContent('.test-um-role-option', /Editor/).click();

    // Save roles and assert that it persists.
    await saveAcls();
    await editWsAcls('Small');
    await assertMaxInheritedRole('In full');
    await assertRole('chimpy', 'Owner', null);
    await assertRole('kiwi', 'Editor', true);
    await assertRole('charon', 'Owner', true);
    await driver.find('.test-um-cancel').click();

    // Assert that Chimpy's role cannot be edited since Chimpy is the active user.
    await editWsAcls('Small');
    const chimpy = driver.findContent('.test-um-member', /chimpy@getgrist.com/);
    await chimpy.find('.test-um-member-role').click();
    await gu.findOpenMenu();
    assert(await driver.findContent('.test-um-role-option', /Editor/).matches('.disabled'));
    assert(await driver.findContent('.test-um-role-option', /Viewer/).matches('.disabled'));
    // Click away to close the menu
    await driver.find(`.test-um-members`).click();

    // Assert that the user cannot delete themselves.
    await chimpy.find('.test-um-member-delete').click();
    assert.equal(await chimpy.find('.test-um-member-undo').isPresent(), false);
    await assertRole('chimpy', 'Owner', null);

    // Add a user and assert that as a new member to the workspace they do have a delete button.
    await driver.find('.test-um-member-new').find('input').click();
    await driver.sendKeys('dummy@getgrist.com', Key.ENTER);
    const dummy = driver.findContent('.test-um-member', /dummy@getgrist.com/);
    await dummy.find('.test-um-member-role').click();
    await gu.findOpenMenu();
    await driver.findContent('.test-um-role-option', /Editor/).click();
    assert(await dummy.find('.test-um-member-delete').isPresent());
    await driver.find('.test-um-cancel').click();
  });

  it('allows updating doc permissions', async () => {
    // Simulate Chimpy login and open Shark doc ACL menu.
    await server.simulateLogin("Chimpy", "chimpy@getgrist.com", "fish");
    await driver.get(`${server.getHost()}/o/fish`);
    await gu.waitForDocMenuToLoad();

    // Open doc options and assert that the initial state is as expected.
    await editDocAcls('Shark');
    await assertMaxInheritedRole('In full');
    await assertRole('chimpy', 'Owner', null);
    await assertRole('kiwi', 'Editor', true);
    await assertRole('charon', 'Owner', true);

    // Public access option should be included for orgs (except with GRIST_SUPPORT_ANON=true,
    // which is only set in single-org setup, and not set for these tests).
    assert.equal(await driver.find('.test-um-public-access').isDisplayed(), true);
    assert.equal(await driver.find('.test-um-public-access').getText(), "Off");

    // Open Access Rules should not be shown (it's currently only shown if a document is open).
    assert.isFalse(await driver.find('.test-um-open-access-rules').isPresent());

    // Lower max inherited role to Editors and check that roles and inheritance tags are as expected.
    // The active user Chimpy's role should remain owner but should no longer be inherited.
    // Kiwi should remain an inherited editor. Charon should lower to an inherited editor.
    await driver.find('.test-um-max-inherited-role').click();
    await gu.findOpenMenu();
    await driver.findContent('.test-um-role-option', /View & edit/).click();
    await assertRole('chimpy', 'Owner', null);
    await assertRole('kiwi', 'Editor', true);
    await assertRole('charon', 'Editor', true);

    // Save new max inherited role and check that it persists.
    await saveAcls();
    await editDocAcls('Shark');
    await assertMaxInheritedRole('View & edit');
    await driver.find('.test-um-cancel').click();

    // Simulate Charon login and assert that Charon can still edit the doc (but cannot edit
    // access to the doc).
    await server.simulateLogin("Charon", "charon@getgrist.com", "fish");
    await driver.get(`${server.getHost()}/o/fish`);
    await gu.waitForDocMenuToLoad();
    await gu.openDocDropdown('Shark');
    await canEditAccess(driver.find('.test-dm-doc-access'), false);

    // Log in with Chimpy once again.
    await server.simulateLogin("Chimpy", "chimpy@getgrist.com", "fish");
    await driver.get(`${server.getHost()}/o/fish`);
    await gu.waitForDocMenuToLoad();

    // Increase Kiwi's role to above the inherited role and check that the inherited tag is
    // no longer visible.
    await editDocAcls('Shark');
    await driver.findContent('.test-um-member', /kiwi@getgrist.com/).find('.test-um-member-role').click();
    await gu.findOpenMenu();
    await driver.findContent('.test-um-role-option', /Owner/).click();
    await saveAcls();
    await editDocAcls('Shark');
    await assertRole('kiwi', 'Owner', false);
    await driver.find('.test-um-cancel').click();

    // Simulate log in with Kiwi and assert that Kiwi can now edit access to the doc.
    await server.simulateLogin("Kiwi", "kiwi@getgrist.com", "fish");
    await driver.get(`${server.getHost()}/o/fish`);
    await gu.waitForDocMenuToLoad();
    await editDocAcls('Shark');

    // Lower max inherited role to none (as Kiwi) and check that Charon's displayed inherited
    // role has lowered to match. Note that the inherited tag is not displayed on users
    // with no access. Kiwi's role should be unchanged.
    await driver.find('.test-um-max-inherited-role').click();
    await gu.findOpenMenu();
    await driver.findContent('.test-um-role-option', /None/).click();
    await assertRole('chimpy', 'Owner', false);
    await assertRole('kiwi', 'Owner', null);
    await assertRole('charon', null, false);

    // Save new max inherited role and check that it persists.
    await saveAcls();
    await editDocAcls('Shark');
    await assertMaxInheritedRole('None');
    await driver.find('.test-um-cancel').click();

    // Simulate log in with Charon and assert the doc is present, but cannot be visited.
    await server.simulateLogin("Charon", "charon@getgrist.com", "fish");
    await driver.get(`${server.getHost()}/o/fish`);
    await gu.waitForDocMenuToLoad();
    assert.equal(await driver.findContent('.test-dm-doc', /Shark/).isPresent(), true);
    await driver.findContent('.test-dm-doc', /Shark/).click();
    assert.match(await driver.findWait('.test-error-header', 2000).getText(), /Access denied/);
    assert.equal(await driver.find('.test-dm-logo').isDisplayed(), true);

    // Log in with Chimpy again and return roles to the initial state.
    await server.simulateLogin("Chimpy", "chimpy@getgrist.com", "fish");
    await driver.get(`${server.getHost()}/o/fish`);
    await gu.waitForDocMenuToLoad();
    await editDocAcls('Shark');
    await driver.find('.test-um-max-inherited-role').click();
    await gu.findOpenMenu();
    await driver.findContentWait('.test-um-role-option', /In full/, 100).click();
    await driver.findContentWait('.test-um-member', /kiwi@getgrist.com/, 100).find('.test-um-member-role').click();
    await driver.findContentWait('.test-um-role-option', /Editor/, 100).click();

    // Save roles and assert that it persists.
    await saveAcls();
    await editDocAcls('Shark');
    await assertMaxInheritedRole('In full');
    await assertRole('chimpy', 'Owner', null);
    await assertRole('kiwi', 'Editor', true);
    await assertRole('charon', 'Owner', true);
    await driver.find('.test-um-cancel').click();

    // Assert that Chimpy's role cannot be edited since Chimpy is the active user.
    await editDocAcls('Shark');
    const chimpy = driver.findContent('.test-um-member', /chimpy@getgrist.com/);
    await chimpy.find('.test-um-member-role').click();
    await gu.findOpenMenu();
    assert(await driver.findContent('.test-um-role-option', /Editor/).matches('.disabled'));
    assert(await driver.findContent('.test-um-role-option', /Viewer/).matches('.disabled'));
    // Click away to close the menu
    await driver.find(`.test-um-members`).click();

    // Assert that the user cannot delete themselves.
    await chimpy.find('.test-um-member-delete').click();
    assert.equal(await chimpy.find('.test-um-member-undo').isPresent(), false);
    await assertRole('chimpy', 'Owner', null);

    // Add a user and assert that as a new member to the doc they do have a delete button.
    await driver.find('.test-um-member-new input').click();
    await driver.sendKeys('dummy@getgrist.com', Key.ENTER);
    const dummy = driver.findContent('.test-um-member', /dummy@getgrist.com/);
    await dummy.find('.test-um-member-role').click();
    await gu.findOpenMenu();
    await driver.findContent('.test-um-role-option', /Editor/).click();
    assert(await dummy.find('.test-um-member-delete').isPresent());
    await driver.find('.test-um-cancel').click();
  });

  it('allows sharing of personal docs', async () => {
    // open chimpy's personal org as chimpy
    await server.simulateLogin("Chimpy", "chimpy@getgrist.com", "docs");
    await driver.get(`${server.getHost()}/o/docs`);
    await gu.waitForDocMenuToLoad();
    assert(await gu.testCurrentUrl(/\/o\/docs/));

    // add zing as a user to a document (personal orgs can't be shared at the org level)
    await editDocAcls('Timesheets');
    await driver.find('.test-um-member-new input').click();
    await driver.sendKeys('zing@getgrist.com', Key.ENTER);
    const zing = driver.findContent('.test-um-member', /zing@getgrist.com/);
    await zing.find('.test-um-member-role').click();
    await gu.findOpenMenu();
    await driver.findContent('.test-um-role-option', /Editor/).click();
    await saveAcls();

    // zing can now access the shared doc in chimpy's personal workspace.
    await server.simulateLogin("zing", "zing@getgrist.com", "docs", {isFirstLogin: false});
    await driver.get(`${server.getHost()}/o/docs`);
    await gu.waitForDocMenuToLoad();
    assert.equal(await driver.findContent('.test-dm-doc-name', /Time/).getText(), 'Timesheets');
  });

  it('new user should have a personal org', async () => {
    // Simulate Chimpy login.
    await server.simulateLogin("Chimpy", "chimpy@getgrist.com", "fish");
    await driver.get(`${server.getHost()}/o/fish`);
    await gu.waitForDocMenuToLoad();

    // Add mysterio and mysterio2 as editors of an organization.
    await editOrgAcls();
    await driver.find('.test-um-member-new input').click();
    await driver.sendKeys('mysterio@getgrist.com', Key.ENTER);
    const mysterio = driver.findContent('.test-um-member', /mysterio@getgrist.com/);
    await mysterio.find('.test-um-member-role').click();
    await gu.findOpenMenu();
    await driver.findContent('.test-um-role-option', /Editor/).click();
    await driver.find('.test-um-member-new input').click();
    await driver.sendKeys('mysterio2@getgrist.com', Key.ENTER);
    const mysterio2 = driver.findContent('.test-um-member', /mysterio@getgrist.com/);
    await mysterio2.find('.test-um-member-role').click();
    await gu.findOpenMenu();
    await driver.findContent('.test-um-role-option', /Editor/).click();
    await saveAcls();

    // Log in as Mr Mysterio for first time, and make sure we have a personal org.
    await server.simulateLogin("Mr Mysterio", "mysterio@getgrist.com", "docs", {isFirstLogin: false});
    await driver.get(`${server.getHost()}/o/docs`);
    await gu.waitForDocMenuToLoad();

    // Check that our name was picked up when we logged in for the first time.
    assert.equal(await gu.getName(), 'Mr Mysterio');

    // Log in as Mysterio2 for first time, without a name, and make sure our name is guessed
    // from email.
    await server.simulateLogin("", "mysterio2@getgrist.com", "fish", {isFirstLogin: false});
    await driver.get(`${server.getHost()}/o/fish`);
    await gu.waitForDocMenuToLoad();
    assert.equal(await gu.getName(), 'mysterio2');
  });

  // NOTE: This tests a bug where the client would prevent editing access to orgs with existing
  // guest users.
  it('should allow adding users to orgs with guests', async () => {
    // Simulate Chimpy login.
    await server.simulateLogin("Chimpy", "chimpy@getgrist.com", "nasa");
    await driver.get(`${server.getHost()}/o/nasa`);
    await gu.waitForDocMenuToLoad();

    // Add a new user.
    await editOrgAcls();
    await driver.find('.test-um-member-new input').click();
    await driver.sendKeys('mario@getgrist.com', Key.ENTER);
    const mario = driver.findContent('.test-um-member', /mario@getgrist.com/);
    await mario.find('.test-um-member-role').click();
    await gu.findOpenMenu();
    await driver.findContent('.test-um-role-option', /Editor/).click();
    await saveAcls();

    // Check that the users are as expected.
    await editOrgAcls();
    await assertRole('chimpy', 'Owner', null);
    await assertRole('mario', 'Editor', null);
    // Charon is only a guest of the org, she should not be visible.
    await assertRole('charon', null, null);
    await driver.find('.test-um-cancel').click();
  });

  it('should allow reverting removals of saved members', async function() {
    await editOrgAcls();
    // Delete Mario and check that confirm is not disabled since changes have been made.
    await driver.findContent('.test-um-member', /mario@getgrist.com/).find('.test-um-member-delete').click();
    assert.equal(await driver.find('.test-um-confirm').getAttribute('disabled'), null);
    // await assert.isFalse($('.test-um-confirm').prop('disabled'));
    // Revert the deletion and check that confirm is disabled since changes have not been made.
    await driver.findContent('.test-um-member', /mario@getgrist.com/).find('.test-um-member-undo').click();
    assert.equal(await driver.find('.test-um-confirm').getAttribute('disabled'), 'true');
    await driver.find('.test-um-cancel').click();
  });

  it('should allow adding members via the add email button', async function() {
    await editOrgAcls();
    await driver.find('.test-um-member-new input').click();
    // Check that the button only appears once there is content in the input.
    assert.equal(await driver.find('.test-um-add-email').isPresent(), false);
    await driver.sendKeys('l');
    assert.equal(await driver.find('.test-um-add-email').isPresent(), true);
    // Attempt to submit the email when it is invalid.
    await driver.sendKeys(Key.DOWN, Key.ENTER);
    // Assert that the value has not been submitted.
    assert.equal(await driver.find('.test-um-member-new').find('input').value(), 'l');
    await driver.sendKeys('uigi@getgrist.com');
    assert.equal(await driver.find('.test-um-add-email').isPresent(), true);
    await driver.sendKeys(Key.DOWN, Key.ENTER);
    // Assert that the value has been submitted
    assert.equal(await driver.find('.test-um-member-new').find('input').value(), '');
    await driver.find('.test-um-cancel').click();
  });

  // Checks a bug where remove buttons would not be properly disabled for users that inherit access.
  it('should disallow removing members whose access is inherited', async function() {
    await editDocAcls('Pluto');
    // Click the remove button for mario.
    await driver.findContent('.test-um-member', /mario@getgrist.com/).find('.test-um-member-delete').click();
    // Check that mario is not actually removed.
    assert(await driver.findContent('.test-um-member', /mario@getgrist.com/).isPresent());
    await driver.find('.test-um-cancel').click();
  });

  // Fixes a confusing scenario where existing but invisible users could not be re-added.
  it('should allow re-adding users who are not visible due to inherited access', async function() {
    // Open doc options and assert that the initial state is as expected.
    await editDocAcls('Beyond');
    await assertMaxInheritedRole('In full');
    await assertRole('chimpy', 'Owner', null);
    await assertRole('mario', 'Editor', true);

    // Lower max inherited role to none and check that mario is no longer visible.
    await driver.find('.test-um-max-inherited-role').click();
    await gu.findOpenMenu();
    await driver.findContent('.test-um-role-option', /None/).click();
    await driver.find('.test-um-member-new input').click();
    await assertRole('chimpy', 'Owner', null);
    await assertRole('mario', null, false);

    // Re-add mario and check that mario is once again visible as a viewer.
    await driver.sendKeys('mario@getgrist.com', Key.ENTER);
    await assertRole('chimpy', 'Owner', null);
    await assertRole('mario', 'Viewer', false);
    await driver.find('.test-um-cancel').click();

    // Perform another more complex test where the user is not visible with full inheritance.
    // Add luigi as a viewer of workspace Horizon
    await editWsAcls('Horizon');
    await driver.find('.test-um-member-new input').click();
    await driver.sendKeys('luigi@getgrist.com', Key.ENTER);
    await assertRole('luigi', 'Viewer', false);
    await saveAcls();

    // Since luigi is a guest of the org, he exists as a no access member of all ws/doc ACLs
    // Ensure that he can still be re-added to a Rover doc with access.
    await editDocAcls('Apathy');
    await driver.find('.test-um-member-new input').click();
    await driver.sendKeys('luigi@getgrist.com', Key.ENTER);
    await assertRole('luigi', 'Viewer', false);
    await saveAcls();

    // Ensure that luigi can still be re-added to the org, where he is already a guest.
    await editOrgAcls();
    await driver.find('.test-um-member-new input').click();
    await driver.sendKeys('luigi@getgrist.com', Key.ENTER);
    await assertRole('luigi', 'Viewer', false);
    await saveAcls();

    // Remove luigi to revert the state
    await editOrgAcls();
    await driver.findContent('.test-um-member', /luigi@getgrist.com/).find('.test-um-member-delete').click();
    await saveAcls();
  });

  // Fixes a small bug where removing would be unnecessarily disabled when maxInheritedRole was None.
  it('should allow removing users when inheritance is set to none', async function() {
    // Open org options and add Luigi.
    await editOrgAcls();
    await driver.find('.test-um-member-new input').click();
    await driver.sendKeys('luigi@getgrist.com', Key.ENTER);
    await assertRole('luigi', 'Viewer', null);
    await saveAcls();

    // Open workspace options, lower max inherited role to None and re-add Luigi.
    await editWsAcls('Horizon');
    await assertRole('luigi', 'Viewer', true);
    await driver.find('.test-um-max-inherited-role').click();
    await gu.findOpenMenu();
    await driver.findContent('.test-um-role-option', /None/).click();
    await driver.find('.test-um-member-new').find('input').click();
    await driver.sendKeys('luigi@getgrist.com', Key.ENTER);
    await assertRole('luigi', 'Viewer', false);

    // Check that Luigi is removable.
    await driver.findContent('.test-um-member', /luigi@getgrist.com/).find('.test-um-member-delete').click();
    await assertRole('luigi', null, null);
    await driver.find('.test-um-cancel').click();

    // Remove luigi from the org to revert the state
    await editOrgAcls();
    await driver.findContent('.test-um-member', /luigi@getgrist.com/).find('.test-um-member-delete').click();
    await saveAcls();
  });

  it('should allow adding org members with no default access', async function() {
    // Open org options and add Luigi with "No Default Access".
    await editOrgAcls();
    await driver.find('.test-um-member-new input').click();
    await driver.sendKeys('luigi@getgrist.com', Key.ENTER);
    await driver.findContent('.test-um-member', /luigi@getgrist.com/).find('.test-um-member-role').click();
    await gu.findOpenMenu();
    await driver.findContent('.test-um-role-option', /No Default Access/).click();
    await saveAcls();

    // Open workspace options and check that Luigi may be added.
    await editWsAcls('Horizon');
    await driver.find('.test-um-member-new input').click();
    await driver.sendKeys('luigi@getgrist.com', Key.ENTER);
    await assertRole('luigi', 'Viewer', false);
    await saveAcls();

    // Re-open org options and check that Luigi's member role has persisted.
    await editOrgAcls();
    await assertRole('luigi', 'No Default Access', false);
    await driver.find('.test-um-cancel').click();

    // Re-open workspace options and check that Luigi's viewership has persisted.
    // Remove it to reset test to previous state.
    await editWsAcls('Horizon');
    await assertRole('luigi', 'Viewer', false);
    await driver.findContent('.test-um-member', /luigi@getgrist.com/).find('.test-um-member-delete').click();
    await saveAcls();

    // Remove Luigi from org to reset test to previous state.
    await editOrgAcls();
    await assertRole('luigi', 'No Default Access', false);
    await driver.findContent('.test-um-member', /luigi@getgrist.com/).find('.test-um-member-delete').click();
    await saveAcls();
  });

  it('should show correct role for active user, even when non-owner', async function() {
    await server.simulateLogin("Chimpy", "chimpy@getgrist.com", "nasa");
    await driver.get(`${server.getHost()}/o/nasa`);
    await gu.waitForDocMenuToLoad();
    await editDocAcls('Pluto');
    await assertRole('chimpy', 'Owner', null);
    await assertRole('charon', 'Viewer', null);
    await driver.findContent('.test-um-member', /charon/).find('.test-um-member-role').click();
    await gu.findOpenMenu();
    await driver.findContent('.test-um-role-option', /Owner/).click();
    await saveAcls();

    // Get the docId.
    const docId = path.basename(await driver.findContent('.test-dm-doc', 'Pluto')
      .find('.test-dm-doc-name').getAttribute('href'));

    // Log in as Charon and load the doc menu.
    await server.simulateLogin("Charon", "charon@getgrist.com", "nasa");
    await driver.get(`${server.getHost()}/o/nasa`);
    await gu.waitForDocMenuToLoad();

    // Lower Charon's access from outside the page. He can still open the UserManager, even though
    // he is no longer an owner. That's fine, but check that the UserManager shows correct role.
    // Update: Charon will now see a very limited UserManager, showing just their own info.
    const api = gu.createHomeApi('Chimpy', 'nasa');
    await api.updateDocPermissions(docId, {users: {'charon@getgrist.com': 'viewers'}});

    await editDocAcls('Pluto');
    await assertAccessDetails('Charon', 'Viewer', 'Outside collaborator');

    // Check title is specialized.
    assert(await driver.find('.test-um-header').getText(), 'Your role for this document');

    // Check that inheritance information is suppressed.
    assert.equal(await driver.find('.test-um-max-inherited-role').isPresent(), false);
  });

  it('should show correct role for users with public access to doc', async function() {
    // Context: A previous bug caused a blank User Manager dialog to be shown.
    const session = await gu.session().teamSite.login();
    const api = session.createHomeApi();
    const {id} = await session.tempDoc(cleanup, 'Hello.grist');
    await api.updateDocPermissions(id, {users: {
      // Make the temp doc public.
      'everyone@getgrist.com': 'viewers',
    }});

    // Check that a logged-in user sees an appropriate role in Access Details.
    const session2 = await gu.session().teamSite.user('user2').login();
    await session2.loadDoc(`/doc/${id}`);
    await editDocAclsShareMenu();
    await assertAccessDetails(session2.name, 'Viewer', 'Public access');

    // Check that an anonymous user sees an appropriate role in Access Details.
    const anon = await gu.session().teamSite.anon.login();
    await anon.loadDoc(`/doc/${id}`);
    await editDocAclsShareMenu();
    await assertAccessDetails('Anonymous', 'Viewer', 'Public access');

    // Add a collaborator to the doc and check that the "Public access" annotation is
    // no longer shown.
    await api.updateDocPermissions(id, {users: {[session2.email]: 'editors'}});
    await session2.login();
    await session2.loadDoc(`/doc/${id}`);
    await editDocAclsShareMenu();
    await assertAccessDetails(session2.name, 'Editor', 'Outside collaborator');

    // Close the dialog.
    await gu.sendKeys(Key.ESCAPE);

    // Add a team member to the site and check that the "Team member" annotation is shown.
    await api.updateOrgPermissions('current', {users: {[session2.email]: 'members'}});
    await editDocAclsShareMenu();
    await assertAccessDetails(session2.name, 'Editor', 'Team member');

    // Turn off role inheriting in the doc, but leave public access intact.
    await api.updateDocPermissions(id, {
      maxInheritedRole: null,
      users: {[session2.email]: null},
    });

    // Reload the page, since real access should have changed from Editor to Viewer.
    await session2.loadDoc(`/doc/${id}`);

    // Check that the team member now sees that they have public access in Access Details.
    await editDocAclsShareMenu();
    await assertAccessDetails(session2.name, 'Viewer', 'Public access');

    // Finally, disable public access but add the team member to the doc explicitly.
    await api.updateDocPermissions(id, {users: {
      [session2.email]: 'editors',
      'everyone@getgrist.com': null,
    }});

    // Check that "Public access" is no longer shown.
    await session2.loadDoc(`/doc/${id}`);
    await editDocAclsShareMenu();
    await assertAccessDetails(session2.name, 'Editor', 'Team member');
  });

  it('can remove user from team even if they have access to a soft-deleted doc', async function() {
    // Open a team site
    const session = await gu.session().teamSite.login();
    await session.loadDocMenu('/');
    const api = session.createHomeApi();
    const users = ['luigi', 'mario', 'silvio'];

    try {
      // Open org options and add some users with "No Default Access".
      await editOrgAcls();
      for (const user of users) {
        await driver.find('.test-um-member-new input').click();
        await driver.sendKeys(`${user}@getgrist.com`, Key.ENTER);
        await driver.findContent('.test-um-member', new RegExp(`${user}@getgrist.com`))
          .find('.test-um-member-role').click();
        await gu.findOpenMenu();
        await driver.findContent('.test-um-role-option', /No Default Access/).click();
      }
      await saveAcls();

      // Make a document and add some users.
      const doc = await session.tempDoc(cleanup, 'Hello.grist', {load: false});
      await api.updateDocPermissions(doc.id, {
        users: {'luigi@getgrist.com': 'viewers', 'mario@getgrist.com': 'owners'},
      });

      // Soft-delete the document.
      await api.softDeleteDoc(doc.id);

      // Remove luigi from team.
      await editOrgAcls();
      await driver.findContent('.test-um-member', /luigi@getgrist.com/).find('.test-um-member-delete').click();
      await saveAcls();

      // Make sure luigi is removed from doc.
      const docUsers = (await api.forRemoved().getDocAccess(doc.id)).users.map(u => u.email);
      assert.includeMembers(docUsers, ['mario@getgrist.com']);
      assert.notInclude(docUsers, 'luigi@getgrist.com');
    }
    finally {
      // Remove users we added.
      await api.updateOrgPermissions('current', {
        users: fromPairs(users.map(u => [`${u}@getgrist.com`, null])),
      });
    }
  });

  it(`has a link to open Access Rules when managing users from an open doc`, async function() {
    const session = await gu.session().teamSite.login();
    await session.loadDocMenu('/');

    // Make a document, and start editing shares.
    await session.tempDoc(cleanup, 'Hello.grist', {load: true});
    await driver.findWait('.test-tb-share', 2000).click();
    await driver.findContentWait('.test-tb-share-option', /Manage users/, 1000).click();

    // Check that Open Access Rules is shown.
    const accessRulesLink = await driver.findWait('.test-um-open-access-rules', 2000);
    assert(accessRulesLink.isPresent());

    // Click it, and check that we are now on the Access Rules page.
    await accessRulesLink.click();
    await gu.testCurrentUrl(/^.+\/p\/acl$/);

    // These days we see the access rules intro screen (since on this doc there aren't access
    // rules yet).
    assert.equal(await driver.findWait('.test-enable-access-rules', 1000).isDisplayed(), true);
  });

});

function findMember(email: string) {
  return driver.findContent('.member-email', email).findClosest('.test-um-member');
}

async function canEditAccess(element: WebElementPromise, canEdit: boolean = true) {
  assert.match(await element.getText(), canEdit ? /Manage/ : /Access [Dd]etails/);
}
