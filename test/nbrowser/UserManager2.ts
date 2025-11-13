import {fromPairs} from 'lodash';
import { assert, driver, Key, WebElement} from 'mocha-webdriver';
import * as gu from 'test/nbrowser/gristUtils';
import {setupTestSuite} from 'test/nbrowser/testUtils';


describe('UserManager2', function() {
  this.timeout('4m');
  const cleanup = setupTestSuite();
  const chimpy = gu.translateUser('user1');
  const charon = gu.translateUser('user2');
  const kiwi = gu.translateUser('user3');
  const ham = gu.translateUser('user4');
  let hasMaxShares: boolean = false;

  before(async function() {
    // Initially teamSite is created with users user1 (gristoid+chimpy@) and support@ as owners,
    // but some tests call resetSite(), leaving it owned only by user1. This test assumes that
    // support@ is among owners, so we ensure that by resetting and adding support@ manually.
    const session = await gu.session().teamSite.user('user1').login();
    await session.resetSite();
    const api = session.createHomeApi();
    await api.updateOrgPermissions(session.settings.orgDomain, {
      users: {'support@getgrist.com': 'owners'}
    });
    const org = await api.getOrg('current');
    // The teamSite may or may not have SaaS limits.
    if (org.billingAccount?.product?.features?.maxSharesPerDoc) {
      hasMaxShares = true;
    }
  });

  for (const landingPage of ['docmenu', 'doc'] as const) {
    it(`can give useful annotations on team site for doc shares opened from ${landingPage}`, async function() {
      if (!hasMaxShares) { this.skip(); }
      // Open a team site
      const session = await gu.session().teamSite.login();
      await session.loadDocMenu('/');
      const api = session.createHomeApi();
      const users = ['zig', 'zag', 'zog'];

      try {
        // Add a user to team.
        await api.updateOrgPermissions('current', {
          users: {'friend@getgrist.com': 'members'},
        });

        // Make a document, and start editing shares.
        await session.tempDoc(cleanup, 'Hello.grist', {load: landingPage === 'doc',
                                                       newName: landingPage + '.grist'});
        const openUserManager = async () => {
          if (landingPage === 'docmenu') {
            await driver.findContent('.test-dm-workspace', /Home/).click();
            await gu.openDocDropdown(landingPage);
            await driver.find('.test-dm-doc-access').click();
          } else {
            await openManageUsers();
          }
        };
        await openUserManager();

        // Check that Open Access Rules is shown in docs but hidden on the doc menu (a previous bug
        // caused this to always be shown).
        if (landingPage === 'doc') {
          assert(await driver.findWait('.test-um-open-access-rules', 2000).isPresent());
        } else {
          assert.isFalse(await driver.find('.test-um-open-access-rules').isPresent());
        }

        // Check that the support user is correctly annotated.
        await gu.waitToPass(async () => {
          const member = await findMember('support@getgrist.com');
          assert.match(await member.getText(), /Grist support/);
        });

        // Check that the owner is correctly annotated.
        await gu.waitToPass(async () => {
          const member = await findMember(session.email);
          assert.match(await member.getText(), /Team member/);
        });

        // Add a member.
        await driver.findWait('.test-um-member-new', 2000).find('input').click();
        await driver.sendKeys('friend@getgrist.com', Key.ENTER);
        // Check that the member is correctly annotated.
        await gu.waitToPass(async () => {
          const member = await findMember('friend@getgrist.com');
          assert.match(await member.getText(), /Team member/);
        });

        // Add a collaborator.
        await driver.find('.test-um-member-new').find('input').click();
        await driver.sendKeys('zig@getgrist.com', Key.ENTER);
        // Check that the collaborator is correctly annotated.
        await gu.waitToPass(async () => {
          const member = await findMember('zig@getgrist.com');
          assert.match(await member.getText(), /1 of 2 guests/);
          assert.match(await member.getText(), /Add member to your team/);
        });

        // Add a second collaborator.
        await driver.find('.test-um-member-new').find('input').click();
        await driver.sendKeys('zag@getgrist.com', Key.ENTER);
        // Check that the collaborator is correctly annotated.
        await gu.waitToPass(async () => {
          const member = await findMember('zag@getgrist.com');
          assert.match(await member.getText(), /2 of 2 guests/);
          assert.match(await member.getText(), /Add member to your team/);
        });

        // Add a third collaborator.
        await driver.find('.test-um-member-new').find('input').click();
        await driver.sendKeys('zog@getgrist.com', Key.ENTER);
        // Check that the collaborator is correctly annotated.
        await gu.waitToPass(async () => {
          const member = await findMember('zog@getgrist.com');
          assert.match(await member.getText(), /Guest limit exceeded/);
          assert.match(await member.getText(), /Add member to your team/);
        });

        // Check an 'Add member' link.
        await findMember('zog@getgrist.com').findContent('a', /Add member/).click();

        // Make sure we end up in team management dialog with email address automatically filled in.
        await gu.waitToPass(async () => {
          const txt = await findModal(/Manage members of team site/)
            .findClosest('.test-modal-dialog')
            .find('.test-um-member-new')
            .find('input')
            .value();
          assert.equal(txt, 'zog@getgrist.com');
        });
        // Wait a moment before proceeding (animation is being shown). Unclear why test hangs without this.
        await driver.sleep(100);

        // Check that Open Access Rules is not shown (a previous bug caused this to always be shown).
        assert.isFalse(await findModal(/Manage members of team site/).find('.test-um-open-access-rules').isPresent());

        // Confirm the member addition.
        await driver.findContent('.test-um-add-email', /email an invite to zog@getgrist.com/).click();
        await findModal(/Manage members of team site/).findWait('.test-um-confirm', 3000).click();

        // Check that the annotation is correctly updated.
        await gu.waitToPass(async () => {
          const member = await findMember('zog@getgrist.com');
          assert.match(await member.getText(), /Team member/);
        });

        // Add the users to the doc.
        await driver.findWait('.test-um-confirm', 3000).click();

        // Reopen dialog and do a sanity check.
        await gu.waitToPass(async () => {
          assert.equal(await driver.find('.test-modal-dialog').isPresent(), false);
        });
        await openUserManager();
        let collaborator1 = await driver.findContentWait('.test-um-member', /1 of 2/, 2000)
          .find('.member-email').getText();
        let collaborator2 = await driver.findContentWait('.test-um-member', /2 of 2/, 2000)
          .find('.member-email').getText();
        // Order of members appears to be a bit arbitrary.
        assert.sameMembers([collaborator1, collaborator2], ['zig@getgrist.com', 'zag@getgrist.com']);

        // Remove a collaborator and check remaining annotation updates ok.
        await findMember(collaborator1).find('.test-um-member-delete').click();
        await gu.waitToPass(async () => {
          const member = await findMember(collaborator2);
          assert.match(await member.getText(), /1 of 2 guests/);
        });

        // Check that public access does not count towards guest limit (a bug previously counted it).
        await driver.find('.test-um-public-access').click();
        await gu.findOpenMenuItem('.test-um-public-option', 'On').click();
        await driver.find('.test-um-member-new').find('input').click();
        await driver.sendKeys("zod@getgrist.com", Key.ENTER);
        await driver.findWait('.test-um-confirm', 3000).click();
        await gu.waitForServer();
        await openUserManager();
        collaborator1 = await driver.findContentWait('.test-um-member', /1 of 2/, 2000)
          .find('.member-email').getText();
        collaborator2 = await driver.findContentWait('.test-um-member', /2 of 2/, 2000)
          .find('.member-email').getText();
        assert.sameMembers([collaborator1, collaborator2], ['zig@getgrist.com', 'zod@getgrist.com']);
      } finally {
        // Remove users we added.
        await api.updateOrgPermissions('current', {
          users: fromPairs(users.map(u => [`${u}@getgrist.com`, null]))
        });
      }
    });
  }

  it('can give useful annotations on personal site', async function() {
    if (!hasMaxShares) { this.skip(); }
    // Open personal site
    const session = await gu.session().personalSite.login();
    await session.loadDocMenu('/');

    // Make a document, and start editing shares.
    await session.tempDoc(cleanup, 'Hello.grist', {load: true});
    await driver.findWait('.test-tb-share', 2000).click();
    await driver.findContent('.test-tb-share-option', /Manage users/).click();

    // Add a collaborator.
    await driver.findWait('.test-um-member-new', 2000).find('input').click();
    await driver.sendKeys('zig@getgrist.com', Key.ENTER);
    // Check that the collaborator is correctly annotated.
    await gu.waitToPass(async () => {
      const member = await findMember('zig@getgrist.com');
      assert.match(await member.getText(), /1 of 2 free collaborators/);
      assert.notMatch(await member.getText(), /Add member to your team/);
    });

    // Add a second collaborator.
    await driver.find('.test-um-member-new').find('input').click();
    await driver.sendKeys('zag@getgrist.com', Key.ENTER);
    // Check that the collaborator is correctly annotated.
    await gu.waitToPass(async () => {
      const member = await findMember('zag@getgrist.com');
      assert.match(await member.getText(), /2 of 2 free collaborators/);
      assert.match(await member.getText(), /Create a team to share with more people/);
    });

    // Add a third collaborator.
    await driver.find('.test-um-member-new').find('input').click();
    await driver.sendKeys('zog@getgrist.com', Key.ENTER);
    // Check that the collaborator is correctly annotated.
    await gu.waitToPass(async () => {
      const member = await findMember('zog@getgrist.com');
      assert.match(await member.getText(), /Free collaborator limit exceeded/);
      assert.match(await member.getText(), /Create a team to share with more people/);
    });

    // Remove first collaborator, make sure other annotations are updated correctly.
    await findMember('zig@getgrist.com').find('.test-um-member-delete').click();
    await gu.waitToPass(async () => {
      assert.match(await findMember('zag@getgrist.com').getText(), /1 of 2/);
      assert.match(await findMember('zog@getgrist.com').getText(), /2 of 2/);
    });
  });

  // There was a bug where annotations were confused by guests of other documents
  it('handles guests correctly', async function() {
    if (!hasMaxShares) { this.skip(); }
    // Open personal site
    const session = await gu.session().personalSite.login();
    await session.loadDocMenu('/');

    // Make a document, and start editing shares.
    await session.tempDoc(cleanup, 'Hello.grist', {load: true});
    await driver.findWait('.test-tb-share', 2000).click();
    await driver.findContent('.test-tb-share-option', /Manage users/).click();

    // Add a collaborator.
    await driver.findWait('.test-um-member-new', 2000).find('input').click();
    await driver.sendKeys('zag@getgrist.com', Key.ENTER);
    // Check that the collaborator is correctly annotated.
    await gu.waitToPass(async () => {
      const member = await findMember('zag@getgrist.com');
      assert.match(await member.getText(), /1 of 2 free collaborators/);
      assert.notMatch(await member.getText(), /Add member to your team/);
    });
    // Add the user to the doc.
    await driver.findWait('.test-um-confirm', 3000).click();

    // Make a new document, and start editing shares.
    await session.tempDoc(cleanup, 'Hello.grist', {load: true});
    await driver.findWait('.test-tb-share', 2000).click();
    await driver.findContent('.test-tb-share-option', /Manage users/).click();

    // Add same collaborator.
    await driver.findWait('.test-um-member-new', 2000).find('input').click();
    await driver.sendKeys('zag@getgrist.com', Key.ENTER);
    // Check that the collaborator is still correctly annotated.
    await gu.waitToPass(async () => {
      const member = await findMember('zag@getgrist.com');
      assert.match(await member.getText(), /1 of 2 free collaborators/);
      assert.notMatch(await member.getText(), /Add member to your team/);
    });
  });

  // There was a bug where support was initially flagged as a collaborator
  it('handles support correctly', async function() {
    if (!hasMaxShares) { this.skip(); }
    const assertSupportAnnotation = async () => {
      await gu.waitToPass(async () => {
        const member = await findMember('support@getgrist.com');
        assert.match(await member.getText(), /Grist support/);
        assert.notMatch(await member.getText(), /2 of 2 free collaborators/);
      });
    };

    // Add the support user.
    await driver.findWait('.test-um-member-new', 2000).find('input').click();
    await driver.sendKeys('support@getgrist.com', Key.ENTER);

    // Check that the support user is correctly annotated.
    await assertSupportAnnotation();

    // Add the support user to the doc.
    await driver.findWait('.test-um-confirm', 3000).click();

    // Re-open the User Manager and check that support is still correctly annotated.
    await gu.waitToPass(async () => {
      assert.equal(await driver.find('.test-modal-dialog').isPresent(), false);
    });
    await driver.findWait('.test-tb-share', 2000).click();
    await driver.findContent('.test-tb-share-option', /Manage users/).click();
    await assertSupportAnnotation();

    // Now add another collaborator and check their annotation.
    await driver.findWait('.test-um-member-new', 2000).find('input').click();
    await driver.sendKeys('not@support.com', Key.ENTER);
    const collaborator = await findMember('not@support.com');
    assert.match(await collaborator.getText(), /2 of 2 free collaborators/);
    assert.notMatch(await collaborator.getText(), /Add member to your team/);
  });

  it('should not make view-as mode disappear on save', async function() {

    // Make a document
    const session = await gu.session().personalSite.login();
    await session.tempDoc(cleanup, 'Hello.grist', {load: true});

    // open access rules
    await driver.find('.test-tools-access-rules').click();
    await driver.findWait('.test-rule-set', 2000);    // Wait for initialization fetch to complete.

    // start view-as mode
    await driver.findContentWait('button', 'View as', 3000).click();
    await driver.findContentWait('.test-acl-user-item', 'viewer@example.com', 100).click();
    await gu.waitForUrl(/aclAsUser/);
    await gu.waitForDocToLoad();

    // check view-as banner is present
    assert.isTrue(await driver.find('.test-view-as-banner').isPresent());

    // open User Manager
    await driver.findWait('.test-tb-share', 2000).click();
    await driver.findContent('.test-tb-share-option', /Manage users/).click();

    // Adds new user and save
    await driver.findWait('.test-um-member-new', 2000).find('input').click();
    await driver.sendKeys('james007@bond.comd', Key.ENTER);
    await driver.find('.test-um-confirm').click();
    await gu.waitForDocToLoad();

    // check view-as banner is present
    assert.isTrue(await driver.find('.test-view-as-banner').isPresent());
  });

  it('should offer view-as for temporary documents', async function() {
    // Login as anonymous user.
    const session = await gu.session().anon.login({
      showTips: false,
      freshAccount: true,
    });
    await session.loadDocMenu('/');
    await driver.find('.test-intro-create-doc').click();
    await gu.waitForDocToLoad();
    await gu.dismissWelcomeTourIfNeeded();

    const testViewAs = async () => {
      // Open access rules
      await driver.find('.test-tools-access-rules').click();
      await driver.findWait('.test-rule-set', 2000);    // Wait for initialization fetch to complete.
      // Start view-as mode. (There was a bug here, where the the server returned an error, and
      // this button wasn't shown to the user. Error was caused by server which was trying to
      // get shared users from not persisted document).
      await driver.findContentWait('button', 'View as', 3000).click();
      await driver.findContentWait('.test-acl-user-item', 'viewer@example.com', 1000).click();
      await gu.isAlertShown().then(v => v ? gu.acceptAlert() : Promise.resolve());
      await gu.waitForUrl(/aclAsUser/);
      await gu.waitForDocToLoad();

      // Check view-as banner is present
      assert.isTrue(await driver.find('.test-view-as-banner').isPresent());

      // Revert and login as user1
      await driver.find('.test-view-as-banner .test-revert').click();
      await gu.isAlertShown().then(v => v ? gu.acceptAlert() : Promise.resolve());
      await gu.waitForDocToLoad();
    };

    // Test that view-as works for temporary document.
    await testViewAs();

    // Now we will login and return to this URL, Grist will remember this document (in cookie) and offer us
    // a chance to save it (but the document still will be temporary).
    const currentUrl = await driver.getCurrentUrl();
    await gu.session().user('user1').login();
    await driver.navigate().refresh();
    await driver.get(currentUrl);
    await gu.waitForDocToLoad();

    await testViewAs();
  });

  it('shows all resource members to resource owner on document access', async function() {
    const session = await gu.session().teamSite.user('user1').login();
    await session.resetSite();
    const api = session.createHomeApi();
    // This tests if an team/workspace owner see members and guests who don't have access to
    // the document.
    const {id: docId} = await session.tempShortDoc(cleanup, 'Hello.grist', {load: false});
    const homeId = await api.getOrgWorkspaces('current').then(l => l[0]!.id);

    // Break the inheritance of the document.
    await session.createHomeApi().updateDocPermissions(docId, {
      maxInheritedRole: null,
    });

    // Add Charon and Kiwi as org members (they won't inherit anything from the org).
    await api.updateOrgPermissions('current', {
      users: {
        [kiwi.email]: 'members',
        [charon.email]: 'members',
        [ham.email]: 'members',
      }
    });

    // Update those users names, as they might be empty if database was cleared by other tests.
    await session.user(charon).login();
    await session.user(kiwi).login();
    await session.user(ham).login();

    // Make Kiwi document editor and workspace owner, and Charon workspace member. Break the inheritance, to make
    // it obvious that team members are not inheriting anything (they are members so they are not).
    await api.updateWorkspacePermissions(homeId, {
      maxInheritedRole: null,
      users: {
        [kiwi.email]: 'owners',
        [charon.email]: 'viewers',
      }
    });
    await api.updateDocPermissions(docId, {
      users: {
        [kiwi.email]: 'editors',
      }
    });

    // As Kiwi, we should be able to see ourselves and Chimpy as an owner. We also got some data about workspace
    // guests but they are not shown in the UI.
    const kiwiSession = await gu.session().teamSite.user(kiwi).login();
    await kiwiSession.loadDoc('/doc/' + docId);
    await openAccessDetails();

    const kiwiEl = await findMember(kiwi.email);
    assert.match(await kiwiEl.getText(), /Team member/);
    assert.equal(await getMemberRole(kiwiEl), 'Editor');

    const chimpyEl = await findMember(gu.translateUser('user1').email);
    assert.match(await chimpyEl.getText(), /Team member/);
    assert.equal(await getMemberRole(chimpyEl), 'Owner');

    // chimpyEl is mentioned in the lower section, Kiwi is first in the list.
    assert.isFalse(await kiwiEl.findClosest('.test-um-access-overview').isPresent());
    assert.isTrue(await chimpyEl.findClosest('.test-um-access-overview').isDisplayed());

    // Charon is not mentioned anywhere in the UI as we show only people with access, whole list is only
    // useful for owners.
    await api.updateDocPermissions(docId, {
      users: {
        [kiwi.email]: 'owners',
      }
    });

    // Now Kiwi, as a workspace owner, will see Charon (a workspace member), but won't see Ham (a team member).
    await gu.reloadDoc();
    await openManageUsers(); // this team we see `Manage Users` instead of `Access Details`.

    // On the list we still see only Chimpy and Kiwi.
    assert.deepEqual(await userEmails(), [chimpy.email, kiwi.email]);

    // But the auto-complete will mention Charon.
    await driver.findWait('.test-um-member-new', 2000).find('input').click();
    assert.deepEqual(await getACItems(), [charon.name, chimpy.name, kiwi.name].sort());
    await gu.sendKeys(Key.ESCAPE);

    // Now login as Chimpy, he is also org owner, so will see everyone.
    await gu.session().teamSite.user(chimpy).login();
    await session.loadDoc('/doc/' + docId);
    await openManageUsers();
    await driver.findWait('.test-um-member-new', 2000).find('input').click();
    assert.deepEqual(await getACItems(), [kiwi.name, chimpy.name, charon.name, ham.name].sort());
    await gu.sendKeys(Key.ESCAPE);

    await session.resetSite();
  });

});

function findMember(email: string) {
  return driver.findContent('.member-email', email).findClosest('.test-um-member');
}

function userEmails() {
  return driver.findAll('.test-um-member-email', e => e.getText());
}

function findModal(title: string|RegExp) {
  return driver.findContentWait('.test-um-header', title, 2000)
    .findClosest('.test-modal-dialog');
}

async function openAccessDetails() {
  await driver.findWait('.test-tb-share', 2000).click();
  await driver.findContent('.test-tb-share-option', /Access Details/).click();
  await driver.findWait('.test-um-header', 2000);
}

async function openManageUsers() {
  await driver.findWait('.test-tb-share', 2000).click();
  await driver.findContentWait('.test-tb-share-option', /Manage users/, 2000).click();
  await driver.findWait('.test-um-header', 2000);
}

async function getMemberRole(memberElem: WebElement): Promise<string|null> {
  const roleElem = memberElem.find('.test-um-member-role');
  const exists = await roleElem.isPresent();
  return exists ? roleElem.getText() : null;
}

async function getACItems() {
  await driver.findWait('.test-acselect-dropdown .test-um-member-name', 2000);
  return driver.findAll('.test-acselect-dropdown .test-um-member-name', (el) => el.getText()).then(l => l.sort());
}
