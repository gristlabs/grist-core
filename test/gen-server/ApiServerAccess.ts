import {Role} from 'app/common/roles';
import {PermissionData, PermissionDelta} from 'app/common/UserAPI';
import {Deps} from 'app/gen-server/ApiServer';
import {Organization} from 'app/gen-server/entity/Organization';
import {Product} from 'app/gen-server/entity/Product';
import {User} from 'app/gen-server/entity/User';
import {HomeDBManager, UserChange} from 'app/gen-server/lib/HomeDBManager';
import {SendGridConfig, SendGridMail} from 'app/gen-server/lib/NotifierTypes';
import axios, {AxiosResponse} from 'axios';
import {delay} from 'bluebird';
import * as chai from 'chai';
import fromPairs = require('lodash/fromPairs');
import pick = require('lodash/pick');
import * as sinon from 'sinon';
import {TestServer} from 'test/gen-server/apiUtils';
import {configForUser} from 'test/gen-server/testUtils';
import * as testUtils from 'test/server/testUtils';

const assert = chai.assert;

let server: TestServer;
let dbManager: HomeDBManager;
let homeUrl: string;
let userCountUpdates: {[orgId: number]: number[]} = {};
let lastMail: SendGridMail|null = null;
let lastMailDesc: string|null = null;
const sandbox = sinon.createSandbox();

const chimpy = configForUser('Chimpy');
const kiwi = configForUser('Kiwi');
const charon = configForUser('Charon');
const nobody = configForUser('Anonymous');

const chimpyEmail = 'chimpy@getgrist.com';
const kiwiEmail = 'kiwi@getgrist.com';
const charonEmail = 'charon@getgrist.com';
const supportEmail = 'support@getgrist.com';
const everyoneEmail = 'everyone@getgrist.com';

let chimpyRef = '';
let kiwiRef = '';
let charonRef = '';

// Test concerns only access-related functions of the ApiServer. Created to help break up the
// large amount of tests on the ApiServer.
describe('ApiServerAccess', function() {

  testUtils.setTmpLogLevel('error');

  let notificationsConfig: SendGridConfig|undefined;
  before(async function() {
    server = new TestServer(this);
    homeUrl = await server.start(['home', 'docs']);
    notificationsConfig = server.server.getNotifier().testSetSendMessageCallback(
      async (payload, desc) => {
        // Filter for invite emails only - ignore any other categories of email
        if (desc.includes('invite')) {
          lastMail = payload;
          lastMailDesc = desc;
        }
      }
    );
    dbManager = server.dbManager;
    chimpyRef = await dbManager.getUserByLogin(chimpyEmail).then((user) => user!.ref);
    kiwiRef = await dbManager.getUserByLogin(kiwiEmail).then((user) => user!.ref);
    charonRef = await dbManager.getUserByLogin(charonEmail).then((user) => user!.ref);
    // Listen to user count updates and add them to an array.
    dbManager.on('userChange', ({org, countBefore, countAfter}: UserChange) => {
      if (countBefore === countAfter) { return; }
      userCountUpdates[org.id] = userCountUpdates[org.id] || [];
      userCountUpdates[org.id].push(countAfter);
    });
  });

  afterEach(async function() {
    userCountUpdates = {};
    await server.sanityCheck();
  });

  after(async function() {
    await server.stop();
    sandbox.restore();
  });

  async function getLastMail(maxWait: number = 1000) {
    const start = Date.now();
    while (Date.now() - start < maxWait) {
      if (!server.server.getNotifier().testPending) {
        const result = {payload: lastMail, description: lastMailDesc};
        lastMailDesc = null;
        lastMail = null;
        return result;
      }
      await delay(1);
    }
    throw new Error('getMessages timed out');
  }

  async function assertLastMail(maxWait: number = 1000) {
    const {payload, description} = await getLastMail(maxWait);
    if (payload === null || description === null) {
      throw new Error('no mail available');
    }
    return {payload, description};
  }

  it('PATCH /api/orgs/{oid}/access is operational', async function() {
    const oid = await dbManager.testGetId('Chimpyland');
    const nasaOrgId = await dbManager.testGetId('NASA');
    // Assert that Charon is NOT allowed to rename a workspace in Chimpyland
    const wid = await dbManager.testGetId('Private');
    const charonResp1 = await axios.patch(`${homeUrl}/api/workspaces/${wid}`, {
      name: 'Charon-Illegal-Rename'
    }, charon);
    assert.equal(charonResp1.status, 403);
    // Move Charon from 'viewers' to 'editors'.
    const delta1 = {
      users: {
        [charonEmail]: 'editors'
      }
    };
    const resp1 = await axios.patch(`${homeUrl}/api/orgs/${oid}/access`, {delta: delta1}, chimpy);
    assert.equal(resp1.status, 200);
    if (notificationsConfig) {
      // Assert that no mail would be sent (Charon already had access).
      assert.equal((await getLastMail()).payload, null);
    }
    // Assert that the number of users in the org has not been updated (Charon role modified only).
    assert.deepEqual(userCountUpdates[oid as number], undefined);
    // Assert that Charon is now allowed to rename workspaces in Chimpyland
    const charonResp2 = await axios.patch(`${homeUrl}/api/workspaces/${wid}`, {
      name: 'Charon-Rename'
    }, charon);
    assert.equal(charonResp2.status, 200);
    // Move Charon back to 'viewers' and add Kiwi to 'editors' (from no permission).
    const delta2 = {
      users: {
        [charonEmail]: 'viewers',
        [kiwiEmail]: 'editors'
      }
    };
    const resp2 = await axios.patch(`${homeUrl}/api/orgs/${oid}/access`, {delta: delta2}, chimpy);
    assert.equal(resp2.status, 200);
    // We should send mail about this one, since Kiwi had no access previously.
    if (notificationsConfig) {
      const mail = await assertLastMail();
      assert.match(mail.description, /^invite kiwi@getgrist.com to http.*\/o\/docs\/\?utm_id=invite-org$/);
      const env = mail.payload.personalizations[0].dynamic_template_data;
      assert.deepEqual(pick(env, ['resource.name', 'resource.kind', 'resource.kindUpperFirst',
                                  'resource.isTeamSite', 'resource.isWorkspace', 'resource.isDocument',
                                  'host.name', 'host.email',
                                  'user.name', 'user.email',
                                  'access.role', 'access.canEdit', 'access.canView']), {
                                    resource: {
                                      name: 'Chimpyland', kind: 'team site', kindUpperFirst: 'Team site',
                                      isTeamSite: true, isWorkspace: false, isDocument: false
                                    },
                                    host: {name: 'Chimpy', email: 'chimpy@getgrist.com'},
                                    user: {name: 'Kiwi', email: 'kiwi@getgrist.com'},
                                    access: {role: 'editors', canEdit: true, canView: true}
                                  } as any);
      assert.match(env.resource.url, /^http.*\/o\/docs\/\?utm_id=invite-org$/);
      assert.deepEqual(mail.payload.personalizations[0].to[0], {email: 'kiwi@getgrist.com', name: 'Kiwi'});
      assert.deepEqual(mail.payload.from, {email: 'support@getgrist.com', name: 'Chimpy (via Grist)'});
      assert.deepEqual(mail.payload.reply_to, {email: 'chimpy@getgrist.com', name: 'Chimpy'});
      assert.deepEqual(mail.payload.template_id, notificationsConfig.template.invite);
    }
    // Assert that the number of users in the org has updated (Kiwi was added).
    assert.deepEqual(userCountUpdates[oid as number], [3]);
    // Assert that Charon is once again NOT allowed to rename workspaces in Chimpyland
    const charonResp3 = await axios.patch(`${homeUrl}/api/workspaces/${wid}`, {
      name: 'Charon-Illegal-Rename-2'
    }, charon);
    assert.equal(charonResp3.status, 403);
    // Assert that Kiwi is now allowed to rename workspaces in Chimpyland
    const kiwiResp1 = await axios.patch(`${homeUrl}/api/workspaces/${wid}`, {
      name: 'Private'
    }, kiwi);
    assert.equal(kiwiResp1.status, 200);
    // Revert the changes and check that behavior is expected once more for good measure.
    const delta3 = {
      users: {
        [kiwiEmail]: null
      }
    };
    const resp3 = await axios.patch(`${homeUrl}/api/orgs/${oid}/access`, {delta: delta3}, chimpy);
    assert.equal(resp3.status, 200);
    if (notificationsConfig) {
      assert.equal((await getLastMail()).description, null);
    }
    // Assert that the number of users in the org has updated (Kiwi was removed).
    assert.deepEqual(userCountUpdates[oid as number], [3, 2]);
    // Assert that Kiwi is NOT allowed to rename workspaces in Chimpyland
    const kiwiResp2 = await axios.patch(`${homeUrl}/api/workspaces/${wid}`, {
      name: 'Kiwi-Illegal-Rename-2'
    }, kiwi);
    assert.equal(kiwiResp2.status, 403);

    // Give Kiwi access to NASA as an editor.
    // NOTE: This tests a bug with adding users to orgs that contain guests. The bug caused existing
    // guests of the org to be removed on any access update.
    const delta4 = {
      users: {
        [kiwiEmail]: 'editors'
      }
    };
    const resp4 = await axios.patch(`${homeUrl}/api/orgs/${nasaOrgId}/access`, {delta: delta4}, chimpy);
    assert.equal(resp4.status, 200);
    if (notificationsConfig) {
      assert.match(
        (await assertLastMail()).description,
        /^invite kiwi@getgrist.com to http.*\/o\/nasa\/\?utm_id=invite-org$/
      );
    }
    // Assert that the number of users in the org has updated (Kiwi was added).
    assert.deepEqual(userCountUpdates[nasaOrgId as number], [2]);
    // Check that access to NASA is as expected.
    const resp5 = await axios.get(`${homeUrl}/api/orgs/${nasaOrgId}/access`, chimpy);
    assert.equal(resp5.status, 200);
    assert.deepEqual(resp5.data, {
      users: [{
        id: 1,
        name: 'Chimpy',
        email: chimpyEmail,
        ref: chimpyRef,
        picture: null,
        access: "owners",
        isMember: true,
      }, {
        id: 2,
        name: 'Kiwi',
        email: kiwiEmail,
        ref: kiwiRef,
        picture: null,
        access: "editors",
        isMember: true,
      }, {
        id: 3,
        name: 'Charon',
        email: charonEmail,
        ref: charonRef,
        picture: null,
        access: "guests",
        isMember: false,
      }]
    });
    // Revoke Kiwi's access to NASA.
    const delta6 = {
      users: {
        [kiwiEmail]: null
      }
    };
    const resp6 = await axios.patch(`${homeUrl}/api/orgs/${nasaOrgId}/access`, {delta: delta6}, chimpy);
    assert.equal(resp6.status, 200);
    if (notificationsConfig) {
      assert.equal((await getLastMail()).description, null);
    }
    // Assert that the number of users in the org has updated (Kiwi was removed).
    assert.deepEqual(userCountUpdates[nasaOrgId as number], [2, 1]);
    // Check that access to NASA is again as expected, this time without Kiwi present.
    const resp7 = await axios.get(`${homeUrl}/api/orgs/${nasaOrgId}/access`, chimpy);
    assert.equal(resp7.status, 200);
    assert.deepEqual(resp7.data, {
      users: [{
        id: 1,
        name: 'Chimpy',
        email: chimpyEmail,
        ref: chimpyRef,
        picture: null,
        access: "owners",
        isMember: true,
      }, {
        id: 3,
        name: 'Charon',
        email: charonEmail,
        ref: charonRef,
        picture: null,
        access: "guests",
        isMember: false,
      }]
    });
  });

  it('PATCH /api/orgs/{oid}/access allows non-owners to remove themselves', async function() {
    const oid = await dbManager.testGetId('NASA');
    const url = `${homeUrl}/api/orgs/${oid}/access`;
    await testAllowNonOwnersToRemoveThemselves(url);
  });

  it('PATCH /api/orgs/{oid}/access returns 404 appropriately', async function() {
    const delta = {
      users: {
        [charonEmail]: null
      }
    };
    const resp = await axios.patch(`${homeUrl}/api/orgs/9999/access`, {delta}, chimpy);
    assert.equal(resp.status, 404);
  });

  it('PATCH /api/orgs/{oid}/access returns 403 appropriately', async function() {
    // Attempt to set access with a user that does not have ACL_EDIT permissions.
    const oid = await dbManager.testGetId('Chimpyland');
    const delta = {
      users: {
        [kiwiEmail]: 'viewers'
      }
    };
    const resp = await axios.patch(`${homeUrl}/api/orgs/${oid}/access`, {delta}, charon);
    assert.equal(resp.status, 403);
  });

  it('PATCH /api/orgs/{oid}/access returns 400 appropriately', async function() {
    // Omit the delta and check that the operation fails with 400.
    const oid = await dbManager.testGetId('Chimpyland');
    const resp1 = await axios.patch(`${homeUrl}/api/orgs/${oid}/access`, {}, chimpy);
    assert.equal(resp1.status, 400);
    // Omit the users object and check that the operation fails with 400.
    const resp2 = await axios.patch(`${homeUrl}/api/orgs/${oid}/access`, {delta: {}}, chimpy);
    assert.equal(resp2.status, 400);
    // Include a maxInheritedRole value and check that the operation fails with 400.
    const delta1 = {maxInheritedRole: null};
    const resp3 = await axios.patch(`${homeUrl}/api/orgs/${oid}/access`, {delta: delta1}, chimpy);
    assert.equal(resp3.status, 400);
    // Attempt to update own permissions check that the operation fails with 400.
    const delta2 = {
      users: {
        [chimpyEmail]: 'viewers'
      }
    };
    const resp4 = await axios.patch(`${homeUrl}/api/orgs/${oid}/access`, {delta: delta2}, chimpy);
    assert.equal(resp4.status, 400);
  });

  it('PATCH /api/workspaces/{wid}/access is operational', async function() {
    const oid = await dbManager.testGetId('Chimpyland');
    const wid = await dbManager.testGetId('Private');

    // Assert that Kiwi is unable to GET the org, since Kiwi has no permissions on the org.
    const kiwiResp1 = await axios.get(`${homeUrl}/api/orgs/${oid}`, kiwi);
    assert.equal(kiwiResp1.status, 403);
    const delta0 = {
      users: {[kiwiEmail]: 'members'}
    };
    const resp0 = await axios.patch(`${homeUrl}/api/orgs/${oid}/access`, {delta: delta0}, chimpy);
    assert.equal(resp0.status, 200);
    // Make Kiwi an editor of the workspace
    const delta1 = {
      users: {[kiwiEmail]: 'editors'}
    };
    const resp2 = await axios.patch(`${homeUrl}/api/workspaces/${wid}/access`, {delta: delta1}, chimpy);
    assert.equal(resp2.status, 200);
    // Check we would sent an email to Kiwi about this
    if (notificationsConfig) {
      const mail = await assertLastMail();
      assert.match(mail.description, /^invite kiwi@getgrist.com to http.*\/o\/docs\/ws\/[0-9]+\/\?utm_id=invite-ws$/);
      const env = mail.payload.personalizations[0].dynamic_template_data;
      assert.match(env.resource.url, /^http.*\/o\/docs\/ws\/[0-9]+\/\?utm_id=invite-ws$/);
      assert.equal(env.resource.kind, 'workspace');
      assert.equal(env.resource.kindUpperFirst, 'Workspace');
      assert.equal(env.resource.isTeamSite, false);
      assert.equal(env.resource.isWorkspace, true);
      assert.equal(env.resource.isDocument, false);
      assert.equal(env.resource.name, 'Private');
    }

    // Assert that the number of users in Chimpyland has updated (Kiwi was added).
    assert.deepEqual(userCountUpdates[oid as number], [3]);
    // Assert that Kiwi is now allowed to rename workspace 'Private' in Chimpyland
    const kiwiResp2 = await axios.patch(`${homeUrl}/api/workspaces/${wid}`, {
      name: 'Kiwi-Rename'
    }, kiwi);
    assert.equal(kiwiResp2.status, 200);
    // Assert that Kiwi is also now able to GET the org, since Kiwi is now a guest of the org.
    const kiwiResp3 = await axios.get(`${homeUrl}/api/orgs/${oid}`, kiwi);
    assert.equal(kiwiResp3.status, 200);

    // Set the maxInheritedRole to 'viewers'
    const delta2 = {
      maxInheritedRole: 'viewers'
    };
    const resp3 = await axios.patch(`${homeUrl}/api/workspaces/${wid}/access`, {delta: delta2}, chimpy);
    assert.equal(resp3.status, 200);
    if (notificationsConfig) {
      assert.equal((await getLastMail()).description, null);
    }
    // Assert that Kiwi is still allowed to rename the workspace.
    const kiwiResp4 = await axios.patch(`${homeUrl}/api/workspaces/${wid}`, {
      name: 'Kiwi-Rename2'
    }, kiwi);
    assert.equal(kiwiResp4.status, 200);
    // Assert that Charon is still allowed to GET the workspace.
    const charonResp1 = await axios.get(`${homeUrl}/api/workspaces/${wid}`, charon);
    assert.equal(charonResp1.status, 200);
    // Assert that as the owner, Chimpy can still rename the workspace.
    const resp4 = await axios.patch(`${homeUrl}/api/workspaces/${wid}`, {
      name: 'Chimpy-Rename'
    }, chimpy);
    assert.equal(resp4.status, 200);

    // Remove inheritance and also update Kiwi's role to viewer.
    const delta3 = {
      maxInheritedRole: null,
      users: {
        [kiwiEmail]: 'viewers'
      }
    };
    const resp5 = await axios.patch(`${homeUrl}/api/workspaces/${wid}/access`, {delta: delta3}, chimpy);
    assert.equal(resp5.status, 200);
    if (notificationsConfig) {
      assert.equal((await getLastMail()).description, null);
    }
    // Assert that Kiwi can still GET the workspace.
    const kiwiResp5 = await axios.get(`${homeUrl}/api/workspaces/${wid}`, kiwi);
    assert.equal(kiwiResp5.status, 200);
    // Assert that Charon can NOT GET the workspace.
    const charonResp2 = await axios.get(`${homeUrl}/api/workspaces/${wid}`, charon);
    assert.equal(charonResp2.status, 403);
    // Assert that as the owner, Chimpy can still rename the workspace.
    const resp6 = await axios.patch(`${homeUrl}/api/workspaces/${wid}`, {
      name: 'Chimpy-Rename2'
    }, chimpy);
    assert.equal(resp6.status, 200);

    // Add Charon as an editor to 'Public', and make sure it does NOT affect org
    // guest access for Kiwi.
    const wid2 = await dbManager.testGetId('Public');
    const delta4 = {
      users: {
        [charonEmail]: 'editors'
      }
    };
    const resp7 = await axios.patch(`${homeUrl}/api/workspaces/${wid2}/access`, {delta: delta4}, chimpy);
    assert.equal(resp7.status, 200);
    if (notificationsConfig) {
      assert.match((await assertLastMail()).description, /^invite charon@getgrist.com /);
    }
    // Assert that Kiwi is still able to GET the org, since Kiwi is still a guest
    // of the org.
    const kiwiResp6 = await axios.get(`${homeUrl}/api/orgs/${oid}`, kiwi);
    assert.equal(kiwiResp6.status, 200);

    // Remove Charon's custom permissions to 'Public'
    const delta5 = {
      users: {
        [charonEmail]: null
      }
    };
    const resp8 = await axios.patch(`${homeUrl}/api/workspaces/${wid2}/access`, {delta: delta5}, chimpy);
    assert.equal(resp8.status, 200);
    if (notificationsConfig) {
      assert.equal((await getLastMail()).description, null);
    }

    // Reset inheritance and remove Kiwi's custom permissions
    const delta6 = {
      maxInheritedRole: 'owners'
    };
    const resp9 = await axios.patch(`${homeUrl}/api/workspaces/${wid}/access`, {delta: delta6}, chimpy);
    assert.equal(resp9.status, 200);
    if (notificationsConfig) {
      assert.equal((await getLastMail()).description, null);
    }

    const removeKiwiDelta = {
      users: {[kiwiEmail]: null}
    };
    const removeKiwiResp = await axios.patch(`${homeUrl}/api/orgs/${oid}/access`,
      {delta: removeKiwiDelta}, chimpy);
    assert.equal(removeKiwiResp.status, 200);
    // TODO: Unnecessary once removing from org removes from all.
    const removeKiwiResp2 = await axios.patch(`${homeUrl}/api/workspaces/${wid}/access`,
      {delta: removeKiwiDelta}, chimpy);
    assert.equal(removeKiwiResp2.status, 200);

    // Assert that the number of users in the org has updated (Kiwi was removed).
    assert.deepEqual(userCountUpdates[oid as number], [3, 2]);

    // Assert that Kiwi is NOT allowed to GET the workspace
    const kiwiResp7 = await axios.get(`${homeUrl}/api/workspaces/${wid}`, kiwi);
    assert.equal(kiwiResp7.status, 403);
    // Assert that Charon can once again GET the workspace
    const charonResp3 = await axios.get(`${homeUrl}/api/workspaces/${wid}`, charon);
    assert.equal(charonResp3.status, 200);
    // Assert that as the owner, Chimpy can still rename the workspace.
    const resp10 = await axios.patch(`${homeUrl}/api/workspaces/${wid}`, {
      name: 'Private'
    }, chimpy);
    assert.equal(resp10.status, 200);
    // Assert that Kiwi is no longer able to GET the org, since Kiwi is no longer a guest
    // of the org.
    const kiwiResp8 = await axios.get(`${homeUrl}/api/orgs/${oid}`, kiwi);
    assert.equal(kiwiResp8.status, 403);
  });

  it('PATCH /api/workspaces/{wid}/access allows non-owners to remove themselves', async function() {
    const wid = await dbManager.testGetId('Private');
    const url = `${homeUrl}/api/workspaces/${wid}/access`;
    await testAllowNonOwnersToRemoveThemselves(url);
  });

  it('PATCH /api/workspaces/{wid}/access returns 404 appropriately', async function() {
    const delta = {
      users: {
        [charonEmail]: null
      }
    };
    const resp = await axios.patch(`${homeUrl}/api/workspaces/9999/access`, {delta}, chimpy);
    assert.equal(resp.status, 404);
  });

  it('PATCH /api/workspaces/{wid}/access returns 403 appropriately', async function() {
    // Attempt to set access with a user that does not have ACL_EDIT permissions.
    const wid = await dbManager.testGetId('Private');
    const delta = {
      users: {
        [kiwiEmail]: 'viewers'
      }
    };
    const resp = await axios.patch(`${homeUrl}/api/workspaces/${wid}/access`, {delta}, charon);
    assert.equal(resp.status, 403);
  });

  it('PATCH /api/workspaces/{wid}/access returns 400 appropriately', async function() {
    // Omit the delta and check that the operation fails with 400.
    const wid = await dbManager.testGetId('Private');
    const resp1 = await axios.patch(`${homeUrl}/api/workspaces/${wid}/access`, {}, chimpy);
    assert.equal(resp1.status, 400);
    // Omit the content and check that the operation fails with 400.
    const resp2 = await axios.patch(`${homeUrl}/api/workspaces/${wid}/access`, {delta: {}}, chimpy);
    assert.equal(resp2.status, 400);
    // Attempt to update own permissions check that the operation fails with 400.
    const delta = {
      users: {
        [chimpyEmail]: 'viewers'
      }
    };
    const resp3 = await axios.patch(`${homeUrl}/api/workspaces/${wid}/access`, {delta}, chimpy);
    assert.equal(resp3.status, 400);
  });

  it('PATCH /api/docs/{did}/access is operational', async function() {
    const oid = await dbManager.testGetId('Chimpyland');
    const wid = await dbManager.testGetId('Private');
    const did = await dbManager.testGetId('Timesheets');

    // Assert that Kiwi is unable to GET the workspace, since Kiwi has no permissions on
    // the org/workspace.
    const kiwiResp1 = await axios.get(`${homeUrl}/api/workspaces/${wid}`, kiwi);
    assert.equal(kiwiResp1.status, 403);
    // Make Kiwi a member of the org.
    const delta0 = {
      users: {[kiwiEmail]: 'members'}
    };
    const resp1 = await axios.patch(`${homeUrl}/api/orgs/${oid}/access`, {delta: delta0}, chimpy);
    assert.equal(resp1.status, 200);

    // Make Kiwi a doc editor for Timesheets
    const delta1 = {
      users: {[kiwiEmail]: 'editors'}
    };
    const resp2 = await axios.patch(`${homeUrl}/api/docs/${did}/access`, {delta: delta1}, chimpy);
    assert.equal(resp2.status, 200);
    // Check we would sent an email to Kiwi about this
    if (notificationsConfig) {
      const mail = await assertLastMail();
      assert.match(mail.description, /^invite kiwi@getgrist.com to http.*\/o\/docs\/doc\/.*$/);
      const env = mail.payload.personalizations[0].dynamic_template_data;
      assert.match(env.resource.url, /^http.*\/o\/docs\/doc\/.*$/);
      assert.equal(env.resource.kind, 'document');
      assert.equal(env.resource.kindUpperFirst, 'Document');
      assert.equal(env.resource.isTeamSite, false);
      assert.equal(env.resource.isWorkspace, false);
      assert.equal(env.resource.isDocument, true);
      assert.equal(env.resource.name, 'Timesheets');
    }

    // Assert that the number of users in Chimpyland has updated (Kiwi was added).
    assert.deepEqual(userCountUpdates[oid as number], [3]);
    // Assert that Kiwi is not allowed to rename doc 'Timesheets' in Chimpyland
    const kiwiResp2 = await axios.patch(`${homeUrl}/api/docs/${did}`, {
      name: 'Kiwi-Rename'
    }, kiwi);
    assert.equal(kiwiResp2.status, 403);
    // Assert that Kiwi is also now able to GET the workspace, since Kiwi is now a guest of
    // the workspace.
    const kiwiResp3 = await axios.get(`${homeUrl}/api/workspaces/${wid}`, kiwi);
    assert.equal(kiwiResp3.status, 200);
    // Assert that Kiwi is also now able to GET the org, since Kiwi is now a guest/member of the org.
    const kiwiResp4 = await axios.get(`${homeUrl}/api/orgs/${oid}`, kiwi);
    assert.equal(kiwiResp4.status, 200);

    // Set the maxInheritedRole to null
    const delta2 = {maxInheritedRole: null};
    const resp3 = await axios.patch(`${homeUrl}/api/docs/${did}/access`, {delta: delta2}, chimpy);
    assert.equal(resp3.status, 200);
    if (notificationsConfig) {
      assert.equal((await getLastMail()).description, null);
    }
    // Assert that Kiwi is still not allowed to rename the doc.
    const kiwiResp5 = await axios.patch(`${homeUrl}/api/docs/${did}`, {
      name: 'Kiwi-Rename2'
    }, kiwi);
    assert.equal(kiwiResp5.status, 403);
    // Assert that Charon cannot view 'Timesheets'.
    const charonResp1 = await axios.get(`${homeUrl}/api/workspaces/${wid}`, charon);
    assert.equal(charonResp1.status, 200);
    assert.deepEqual(charonResp1.data.docs.map((doc: any) => doc.name), ['Appointments']);
    // Assert that as the owner, Chimpy can still rename the doc.
    const resp4 = await axios.patch(`${homeUrl}/api/docs/${did}`, {
      name: 'Chimpy-Rename'
    }, chimpy);
    assert.equal(resp4.status, 200);

    // Add inheritance for viewers and also update Kiwi's role to viewer.
    const delta3 = {
      maxInheritedRole: 'viewers',
      users: {
        [kiwiEmail]: 'viewers'
      }
    };
    const resp5 = await axios.patch(`${homeUrl}/api/docs/${did}/access`, {delta: delta3}, chimpy);
    assert.equal(resp5.status, 200);
    if (notificationsConfig) {
      assert.equal((await getLastMail()).description, null);
    }
    // Assert that Kiwi can still view the doc.
    const kiwiResp6 = await axios.get(`${homeUrl}/api/workspaces/${wid}`, kiwi);
    assert.equal(kiwiResp6.status, 200);
    assert.deepEqual(kiwiResp6.data.docs.map((doc: any) => doc.name),
      ['Chimpy-Rename']);
    // Assert that Charon can now view the doc.
    const charonResp2 = await axios.get(`${homeUrl}/api/workspaces/${wid}`, charon);
    assert.equal(charonResp2.status, 200);
    assert.deepEqual(charonResp2.data.docs.map((doc: any) => doc.name),
      ['Chimpy-Rename', 'Appointments']);
    // Assert that Charon can NOT rename the doc.
    const charonResp3 = await axios.patch(`${homeUrl}/api/docs/${did}`, {
      name: 'Charon-Invalid-Rename',
    }, charon);
    assert.equal(charonResp3.status, 403);
    // Assert that as the owner, Chimpy can still rename the doc.
    const resp6 = await axios.patch(`${homeUrl}/api/docs/${did}`, {
      name: 'Timesheets'
    }, chimpy);
    assert.equal(resp6.status, 200);

    // Add Charon as an editor to 'Appointments', and make sure it does NOT affect org
    // or workspace guest access for Kiwi.
    const did2 = await dbManager.testGetId('Appointments');
    const delta4 = {
      users: {
        [charonEmail]: 'editors'
      }
    };
    const resp7 = await axios.patch(`${homeUrl}/api/docs/${did2}/access`, {delta: delta4}, chimpy);
    assert.equal(resp7.status, 200);
    if (notificationsConfig) {
      assert.match((await assertLastMail()).description, /^invite charon@getgrist.com /);
    }
    // Assert that Kiwi is still able to GET the workspace, since Kiwi is still a
    // guest of the workspace.
    const kiwiResp7 = await axios.get(`${homeUrl}/api/workspaces/${wid}`, kiwi);
    assert.equal(kiwiResp7.status, 200);
    // Assert that Kiwi is still able to GET the org, since Kiwi is still a guest
    // of the org.
    const kiwiResp8 = await axios.get(`${homeUrl}/api/orgs/${oid}`, kiwi);
    assert.equal(kiwiResp8.status, 200);

    // Remove Charon's custom permissions to 'Appointments'
    const delta5 = {
      users: {
        [charonEmail]: null
      }
    };
    const resp8 = await axios.patch(`${homeUrl}/api/docs/${did2}/access`, {delta: delta5}, chimpy);
    assert.equal(resp8.status, 200);

    // Reset doc inheritance setting
    const delta6 = {
      maxInheritedRole: 'owners',
    };
    const resp9 = await axios.patch(`${homeUrl}/api/docs/${did}/access`, {delta: delta6}, chimpy);
    assert.equal(resp9.status, 200);
    if (notificationsConfig) {
      assert.equal((await getLastMail()).description, null);
    }

    // Remove Kiwi from the org.
    const removeKiwiDelta = {
      users: {[kiwiEmail]: null}
    };
    const resp10 = await axios.patch(`${homeUrl}/api/orgs/${oid}/access`,
      {delta: removeKiwiDelta}, chimpy);
    assert.equal(resp10.status, 200);
    // TODO: Unnecessary once removing from org removes from all.
    const resp11 = await axios.patch(`${homeUrl}/api/docs/${did}/access`,
      {delta: removeKiwiDelta}, chimpy);
    assert.equal(resp11.status, 200);

    // Assert that the number of users in Chimpyland has updated (Kiwi was removed).
    assert.deepEqual(userCountUpdates[oid as number], [3, 2]);
    // Assert that Kiwi is no longer able to GET the workspace, since Kiwi is no longer a
    // guest of the workspace.
    const kiwiResp9 = await axios.get(`${homeUrl}/api/workspaces/${wid}`, kiwi);
    assert.equal(kiwiResp9.status, 403);
    // Assert that Kiwi is no longer able to GET the org, since Kiwi is no longer a guest/member
    // of the org.
    const kiwiResp10 = await axios.get(`${homeUrl}/api/orgs/${oid}`, kiwi);
    assert.equal(kiwiResp10.status, 403);
  });

  it('PATCH /api/docs/{did}/access allows non-owners to remove themselves', async function() {
    const did = await dbManager.testGetId('Timesheets');
    const url = `${homeUrl}/api/docs/${did}/access`;
    await testAllowNonOwnersToRemoveThemselves(url);
  });

  it('PATCH /api/docs/{did}/access can send multiple invites', async function() {
    const did = await dbManager.testGetId('Timesheets');

    let delta: PermissionDelta = {
      users: {
        'user1@getgrist.com': 'editors',
        'user2@getgrist.com': 'viewers',
        'user3@getgrist.com': 'viewers',
      }
    };
    let resp = await axios.patch(`${homeUrl}/api/docs/${did}/access`, {delta}, chimpy);
    assert.equal(resp.status, 200);
    if (notificationsConfig) {
      const mail = await assertLastMail();
      assert.lengthOf(mail.payload.personalizations, 3);
      assert.sameMembers(mail.payload.personalizations.map(p => p.to[0].email),
                         ['user1@getgrist.com', 'user2@getgrist.com', 'user3@getgrist.com']);
      assert.deepEqual(mail.payload.personalizations.map(p => p.dynamic_template_data.access),
                       [{role: 'editors', canEdit: true, canView: true, canEditAccess: false},
                        {role: 'viewers', canEdit: false, canView: true, canEditAccess: false},
                        {role: 'viewers', canEdit: false, canView: true, canEditAccess: false}]);
    }
    delta = {
      users: {
        'user2@getgrist.com': null,
        'user3@getgrist.com': 'editors',
        'user4@getgrist.com': 'viewers',
      }
    };
    resp = await axios.patch(`${homeUrl}/api/docs/${did}/access`, {delta}, chimpy);
    assert.equal(resp.status, 200);
    if (notificationsConfig) {
      const mail = await assertLastMail();
      assert.lengthOf(mail.payload.personalizations, 1);
      assert.deepEqual(mail.payload.personalizations[0].to, [{
        email: 'user4@getgrist.com',
        name: '',  // name is blank since this user has never logged in.
      }]);
    }
    delta = {
      users: {
        'user1@getgrist.com': null,
        'user3@getgrist.com': null,
        'user4@getgrist.com': null,
      }
    };
    resp = await axios.patch(`${homeUrl}/api/docs/${did}/access`, {delta}, chimpy);
    assert.equal(resp.status, 200);
    if (notificationsConfig) {
      assert.equal((await getLastMail()).payload, null);
    }
  });

  it('PATCH /api/docs/{did}/access returns 404 appropriately', async function() {
    const delta = {
      users: {
        [charonEmail]: null
      }
    };
    const resp = await axios.patch(`${homeUrl}/api/docs/9999/access`, {delta}, chimpy);
    assert.equal(resp.status, 404);
  });

  it('PATCH /api/docs/{did}/access returns 403 appropriately', async function() {
    // Attempt to set access with a user that does not have ACL_EDIT permissions.
    const did = await dbManager.testGetId('Timesheets');
    const delta = {
      users: {
        [kiwiEmail]: 'viewers'
      }
    };
    const resp = await axios.patch(`${homeUrl}/api/docs/${did}/access`, {delta}, charon);
    assert.equal(resp.status, 403);
  });

  it('PATCH /api/docs/{did}/access returns 400 appropriately', async function() {
    // Omit the delta and check that the operation fails with 400.
    const did = await dbManager.testGetId('Timesheets');
    const resp1 = await axios.patch(`${homeUrl}/api/docs/${did}/access`, {}, chimpy);
    assert.equal(resp1.status, 400);
    // Omit the content and check that the operation fails with 400.
    const resp2 = await axios.patch(`${homeUrl}/api/docs/${did}/access`, {delta: {}}, chimpy);
    assert.equal(resp2.status, 400);
    // Attempt to update own permissions check that the operation fails with 400.
    const delta = {
      users: {
        [chimpyEmail]: 'viewers'
      }
    };
    const resp3 = await axios.patch(`${homeUrl}/api/docs/${did}/access`, {delta}, chimpy);
    assert.equal(resp3.status, 400);
  });

  it('GET /api/orgs/{oid}/access is operational', async function() {
    const oid = await dbManager.testGetId('Chimpyland');
    const resp = await axios.get(`${homeUrl}/api/orgs/${oid}/access`, chimpy);
    assert.equal(resp.status, 200);
    assert.deepEqual(resp.data, {
      users: [{
        id: 1,
        name: 'Chimpy',
        email: chimpyEmail,
        ref: chimpyRef,
        picture: null,
        access: "owners",
        isMember: true,
      }, {
        id: 3,
        name: 'Charon',
        email: charonEmail,
        ref: charonRef,
        picture: null,
        access: "viewers",
        isMember: true,
      }]
    });
  });

  it('GET /api/orgs/{oid}/access returns 404 appropriately', async function() {
    const resp = await axios.get(`${homeUrl}/api/orgs/9999/access`, chimpy);
    assert.equal(resp.status, 404);
  });

  it('GET /api/orgs/{oid}/access returns 403 appropriately', async function() {
    const oid = await dbManager.testGetId('Chimpyland');
    const resp = await axios.get(`${homeUrl}/api/orgs/${oid}/access`, kiwi);
    assert.equal(resp.status, 403);
  });

  it('GET /api/workspaces/{wid}/access is operational', async function() {
    // Run a simple case on a Chimpyland workspace
    const oid = await dbManager.testGetId('Chimpyland');
    const wid = await dbManager.testGetId('Public');
    const resp1 = await axios.get(`${homeUrl}/api/workspaces/${wid}/access`, chimpy);
    assert.equal(resp1.status, 200);
    assert.deepEqual(resp1.data, {
      maxInheritedRole: "owners",
      users: [{
        id: 1,
        name: 'Chimpy',
        email: chimpyEmail,
        ref: chimpyRef,
        picture: null,
        access: null,
        parentAccess: "owners",
        isMember: true,
      }, {
        id: 3,
        name: 'Charon',
        email: charonEmail,
        ref: charonRef,
        picture: null,
        access: null,
        parentAccess: "viewers",
        isMember: true,
      }]
    });
    // Run a complex case by modifying maxInheritedRole and individual roles on the workspace,
    // then querying for access
    // Set the maxInheritedRole to null
    const kiwiMemberDelta = {
      users: {[kiwiEmail]: "members"}
    };
    const orgPatchResp = await axios.patch(`${homeUrl}/api/orgs/${oid}/access`,
      {delta: kiwiMemberDelta}, chimpy);
    assert.equal(orgPatchResp.status, 200);

    const delta = {
      maxInheritedRole: null,
      users: {
        [kiwiEmail]: "editors"
      }
    };
    const patchResp = await axios.patch(`${homeUrl}/api/workspaces/${wid}/access`, {delta}, chimpy);
    assert.equal(patchResp.status, 200);
    const resp2 = await axios.get(`${homeUrl}/api/workspaces/${wid}/access`, chimpy);
    assert.equal(resp2.status, 200);
    assert.deepEqual(resp2.data, {
      maxInheritedRole: null,
      users: [{
        id: 1,
        name: 'Chimpy',
        email: chimpyEmail,
        ref: chimpyRef,
        picture: null,
        // Note that chimpy's access has been elevated to "owners"
        access: "owners",
        parentAccess: "owners",
        isMember: true,
      }, {
        id: 2,
        name: 'Kiwi',
        email: kiwiEmail,
        ref: kiwiRef,
        picture: null,
        access: "editors",
        parentAccess: null,
        isMember: true,
      }, {
        id: 3,
        name: 'Charon',
        email: charonEmail,
        ref: charonRef,
        picture: null,
        access: null,
        parentAccess: "viewers",
        isMember: true,
      }]
    });

    const deltaOrg = {
      users: {
        [kiwiEmail]: "owners",
      }
    };
    const respDeltaOrg = await axios.patch(`${homeUrl}/api/orgs/${oid}/access`, {delta: deltaOrg}, chimpy);
    assert.equal(respDeltaOrg.status, 200);

    const resp3 = await axios.get(`${homeUrl}/api/workspaces/${wid}/access`, chimpy);
    assert.include(resp3.data.users.find((user: any) => user.email === kiwiEmail), {
      access: "editors",
      parentAccess: "owners"
    });

    // Reset the access settings
    const resetDelta = {
      maxInheritedRole: "owners",
      users: {
        [kiwiEmail]: null
      }
    };
    const resetResp = await axios.patch(`${homeUrl}/api/workspaces/${wid}/access`, {delta: resetDelta}, chimpy);
    assert.equal(resetResp.status, 200);
    const resetOrgDelta = {
      users: {
        [kiwiEmail]: "members",
      }
    };
    const resetOrgResp = await axios.patch(`${homeUrl}/api/orgs/${oid}/access`, {delta: resetOrgDelta}, chimpy);
    assert.equal(resetOrgResp.status, 200);

    // Assert that ws guests are properly displayed.
    // Tests a minor bug that showed ws guests as having null access.
    // Add a doc to 'Public', and add Kiwi to the doc.
    // Add a doc to 'Public'
    const addDocResp = await axios.post(`${homeUrl}/api/workspaces/${wid}/docs`, {
      name: 'PublicDoc'
    }, chimpy);
    // Assert that the response is successful
    assert.equal(addDocResp.status, 200);
    const did = addDocResp.data;

    // Add Kiwi to the doc
    const docAccessResp = await axios.patch(`${homeUrl}/api/docs/${did}/access`, {delta}, chimpy);
    assert.equal(docAccessResp.status, 200);

    // Assert that Kiwi is now a guest of public.
    const wsResp = await axios.get(`${homeUrl}/api/workspaces/${wid}/access`, chimpy);
    assert.equal(wsResp.status, 200);
    assert.deepEqual(wsResp.data, {
      maxInheritedRole: "owners",
      users: [{
        id: 1,
        name: 'Chimpy',
        email: chimpyEmail,
        ref: chimpyRef,
        picture: null,
        access: "owners",
        parentAccess: "owners",
        isMember: true,
      }, {
        id: 2,
        name: 'Kiwi',
        email: kiwiEmail,
        ref: kiwiRef,
        picture: null,
        access: "guests",
        parentAccess: null,
        isMember: true,
      }, {
        id: 3,
        name: 'Charon',
        email: charonEmail,
        ref: charonRef,
        picture: null,
        access: null,
        parentAccess: "viewers",
        isMember: true,
      }]
    });

    // Remove the doc.
    const deleteResp = await axios.delete(`${homeUrl}/api/docs/${did}`, chimpy);
    assert.equal(deleteResp.status, 200);

    // Assert that Kiwi is no longer a guest of public.
    const wsResp2 = await axios.get(`${homeUrl}/api/workspaces/${wid}/access`, chimpy);
    assert.equal(wsResp2.status, 200);
    assert.deepEqual(wsResp2.data, {
      maxInheritedRole: "owners",
      users: [{
        id: 1,
        name: 'Chimpy',
        email: chimpyEmail,
        ref: chimpyRef,
        picture: null,
        access: "owners",
        parentAccess: "owners",
        isMember: true,
      }, {
        id: 2,
        name: "Kiwi",
        email: kiwiEmail,
        ref: kiwiRef,
        picture: null,
        access: null,
        parentAccess: null,
        isMember: true,
      }, {
        id: 3,
        name: 'Charon',
        email: charonEmail,
        ref: charonRef,
        picture: null,
        access: null,
        parentAccess: "viewers",
        isMember: true,
      }]
    });

    // Remove Kiwi from the org to reset initial settings
    const kiwiResetDelta = {
      users: {[kiwiEmail]: null}
    };
    const orgPatchResp2 = await axios.patch(`${homeUrl}/api/orgs/${oid}/access`,
      {delta: kiwiResetDelta}, chimpy);
    assert.equal(orgPatchResp2.status, 200);
  });

  it('GET /api/workspaces/{wid}/access returns 404 appropriately', async function() {
    const resp = await axios.get(`${homeUrl}/api/workspaces/9999/access`, chimpy);
    assert.equal(resp.status, 404);
  });

  it('GET /api/workspaces/{wid}/access returns 403 appropriately', async function() {
    const wid = await dbManager.testGetId('Private');
    const resp = await axios.get(`${homeUrl}/api/workspaces/${wid}/access`, kiwi);
    assert.equal(resp.status, 403);
  });

  it('GET /api/docs/{did}/access is operational', async function() {
    // Run a simple case on a Chimpyland doc
    const oid = await dbManager.testGetId('Chimpyland');
    const did = await dbManager.testGetId('Timesheets');
    const resp1 = await axios.get(`${homeUrl}/api/docs/${did}/access`, chimpy);
    assert.equal(resp1.status, 200);
    assert.deepEqual(resp1.data, {
      maxInheritedRole: "owners",
      users: [{
        id: 1,
        name: 'Chimpy',
        email: chimpyEmail,
        ref: chimpyRef,
        picture: null,
        // Note that Chimpy explicitly has owners access to the doc from a previous test.
        access: "owners",
        parentAccess: "owners",
        isMember: true,
      }, {
        id: 3,
        name: 'Charon',
        email: charonEmail,
        ref: charonRef,
        picture: null,
        access: null,
        parentAccess: "viewers",
        isMember: true,
      }]
    });

    // Add kiwi as a member of Chimpyland
    const kiwiMemberDelta = {
      users: {[kiwiEmail]: "members"}
    };
    const kiwiMemberResp = await axios.patch(`${homeUrl}/api/orgs/${oid}/access`,
      {delta: kiwiMemberDelta}, chimpy);
    assert.equal(kiwiMemberResp.status, 200);
    // Run a complex case by modifying maxInheritedRole and individual roles on a doc then querying
    // for access
    // Set the maxInheritedRole to null
    const delta = {
      maxInheritedRole: null,
      users: {[kiwiEmail]: "editors"}
    };
    const patchResp = await axios.patch(`${homeUrl}/api/docs/${did}/access`, {delta}, chimpy);
    assert.equal(patchResp.status, 200);
    const resp2 = await axios.get(`${homeUrl}/api/docs/${did}/access`, chimpy);
    assert.equal(resp2.status, 200);
    assert.deepEqual(resp2.data, {
      maxInheritedRole: null,
      users: [{
        id: 1,
        name: 'Chimpy',
        email: chimpyEmail,
        ref: chimpyRef,
        picture: null,
        access: "owners",
        parentAccess: "owners",
        isMember: true,
      }, {
        id: 2,
        name: 'Kiwi',
        email: kiwiEmail,
        ref: kiwiRef,
        picture: null,
        access: "editors",
        parentAccess: null,
        isMember: true,
      }, {
        id: 3,
        name: 'Charon',
        email: charonEmail,
        ref: charonRef,
        picture: null,
        access: null,
        parentAccess: "viewers",
        isMember: true,
      }]
    });
    // Reset the access settings
    const kiwiResetDelta = {
      users: {[kiwiEmail]: null}
    };
    const kiwiResetResp = await axios.patch(`${homeUrl}/api/orgs/${oid}/access`,
      {delta: kiwiResetDelta}, chimpy);
    assert.equal(kiwiResetResp.status, 200);
    // TODO: Unnecessary once removing from org removes from all.
    const resetDelta = {
      maxInheritedRole: "owners",
      users: {
        [kiwiEmail]: null
      }
    };
    const resetResp = await axios.patch(`${homeUrl}/api/docs/${did}/access`, {delta: resetDelta}, chimpy);
    assert.equal(resetResp.status, 200);

    // Run another complex case by modifying maxInheritedRole and individual roles of the workspace
    // the doc is in then querying for access.
    const shark = await dbManager.testGetId('Shark');
    const sharkWs = await dbManager.testGetId('Big');
    const wsDelta = {
      maxInheritedRole: "viewers"
    };
    const patchResp2 = await axios.patch(`${homeUrl}/api/workspaces/${sharkWs}/access`, {delta: wsDelta}, chimpy);
    assert.equal(patchResp2.status, 200);
    const resp3 = await axios.get(`${homeUrl}/api/docs/${shark}/access`, chimpy);
    assert.equal(resp3.status, 200);
    // Assert that the maxInheritedRole of the workspace limits inherited access from the org.
    assert.deepEqual(resp3.data, {
      maxInheritedRole: 'owners',
      users: [{
        id: 1,
        name: 'Chimpy',
        email: chimpyEmail,
        ref: chimpyRef,
        picture: null,
        // Note that Chimpy's access to shark is inherited from the workspace, of which he is
        // explicitly an owner.
        access: null,
        parentAccess: "owners",
        isMember: true,
      }, {
        id: 2,
        name: 'Kiwi',
        email: kiwiEmail,
        ref: kiwiRef,
        picture: null,
        access: null,
        parentAccess: "viewers",
        isMember: true,
      }, {
        id: 3,
        name: 'Charon',
        email: charonEmail,
        ref: charonRef,
        picture: null,
        access: null,
        parentAccess: "viewers",
        isMember: true,
      }]
    });
    // Reset the access settings
    const resetDelta2 = {
      maxInheritedRole: "owners"
    };
    const resetResp2 = await axios.patch(`${homeUrl}/api/workspaces/${sharkWs}/access`, {delta: resetDelta2}, chimpy);
    assert.equal(resetResp2.status, 200);
  });

  it('GET /api/docs/{did}/access returns 404 appropriately', async function() {
    const resp = await axios.get(`${homeUrl}/api/docs/9999/access`, chimpy);
    assert.equal(resp.status, 404);
  });

  it('GET /api/docs/{did}/access returns 403 appropriately', async function() {
    const did = await dbManager.testGetId('Timesheets');
    const resp = await axios.get(`${homeUrl}/api/docs/${did}/access`, kiwi);
    assert.equal(resp.status, 403);
  });

  it('should show special users if they are added', async function() {
    // TODO We may want to expose special flags in requests and responses rather than allow adding
    // and retrieving special email addresses. For now, just make sure that if we succeed adding a
    // a special user, that we can also retrieve it.
    const wid = await dbManager.testGetId('Private');
    const did = await dbManager.testGetId('Timesheets');    // This is inside workspace `wid`

    // Turns users from PermissionData into a mapping from email address to [access, parentAccess],
    // for more concise comparisons below.
    function compactAccess(data: PermissionData): {[email: string]: [Role|null, Role|null]} {
      return fromPairs(data.users.map((u) => [u.email, [u.access, u.parentAccess || null]]));
    }

    let resp = await axios.patch(`${homeUrl}/api/workspaces/${wid}/access`,
      {delta: {users: {[everyoneEmail]: 'viewers'}}}, chimpy);
    assert.equal(resp.status, 200);

    // The special user should be visible when we get the access list.
    resp = await axios.get(`${homeUrl}/api/workspaces/${wid}/access`, chimpy);
    assert.deepEqual(compactAccess(resp.data), {
      [chimpyEmail]: ['owners', 'owners'],
      [charonEmail]: [null, 'viewers'],
      [everyoneEmail]: ['viewers', null],
    });

    // The special user should be visible on the doc too, since it's inherited.
    resp = await axios.get(`${homeUrl}/api/docs/${did}/access`, chimpy);
    assert.deepEqual(compactAccess(resp.data), {
      [chimpyEmail]: ['owners', 'owners'],
      [charonEmail]: [null, 'viewers'],
      [everyoneEmail]: [null, 'viewers'],
    });

    // Remove the special user; it should no longer be visible on either.
    resp = await axios.patch(`${homeUrl}/api/workspaces/${wid}/access`,
      {delta: {users: {[everyoneEmail]: null}}}, chimpy);
    resp = await axios.get(`${homeUrl}/api/workspaces/${wid}/access`, chimpy);
    assert.deepEqual(compactAccess(resp.data), {
      [chimpyEmail]: ['owners', 'owners'],
      [charonEmail]: [null, 'viewers'],
    });
    resp = await axios.get(`${homeUrl}/api/docs/${did}/access`, chimpy);
    assert.deepEqual(compactAccess(resp.data), {
      [chimpyEmail]: ['owners', 'owners'],
      [charonEmail]: [null, 'viewers'],
    });

    // Add special user to the doc.
    resp = await axios.patch(`${homeUrl}/api/docs/${did}/access`,
      {delta: {users: {[everyoneEmail]: 'editors'}}}, chimpy);
    assert.equal(resp.status, 200);
    resp = await axios.get(`${homeUrl}/api/docs/${did}/access`, chimpy);
    assert.deepEqual(compactAccess(resp.data), {
      [chimpyEmail]: ['owners', 'owners'],
      [charonEmail]: [null, 'viewers'],
      [everyoneEmail]: ['editors', null],
    });

    // But it should not be visible on the workspace.
    resp = await axios.get(`${homeUrl}/api/workspaces/${wid}/access`, chimpy);
    assert.deepEqual(compactAccess(resp.data), {
      [chimpyEmail]: ['owners', 'owners'],
      [charonEmail]: [null, 'viewers'],
    });

    // Remove the special user.
    resp = await axios.patch(`${homeUrl}/api/docs/${did}/access`,
      {delta: {users: {[everyoneEmail]: null}}}, chimpy);
    resp = await axios.get(`${homeUrl}/api/docs/${did}/access`, chimpy);
    assert.deepEqual(compactAccess(resp.data), {
      [chimpyEmail]: ['owners', 'owners'],
      [charonEmail]: [null, 'viewers'],
    });
  });

  it('should allow setting member role', async function() {
    const oid = await dbManager.testGetId('Chimpyland');
    const wid = await dbManager.testGetId('Private');
    const did = await dbManager.testGetId('Timesheets');
    const addDelta = {
      users: { [kiwiEmail]: "members" }
    };
    const removeDelta = {
      users: { [kiwiEmail]: null }
    };

    // Set Kiwi as a member of org 'Chimpyland'.
    const addKiwiToOrg = await axios.patch(`${homeUrl}/api/orgs/${oid}/access`,
      {delta: addDelta}, chimpy);
    assert.equal(addKiwiToOrg.status, 200);

    // Fetch workspace permissions and check that Kiwi has and inherits no access.
    const kiwiWsAccess = await axios.get(`${homeUrl}/api/workspaces/${wid}/access`, chimpy);
    assert.equal(kiwiWsAccess.status, 200);
    assert.deepEqual(kiwiWsAccess.data, {
      maxInheritedRole: 'owners',
      users: [{
        id: 1,
        name: 'Chimpy',
        email: chimpyEmail,
        ref: chimpyRef,
        picture: null,
        // Note that Chimpy already has ownership access to the workspace.
        access: "owners",
        parentAccess: "owners",
        isMember: true,
      }, {
        id: 2,
        name: 'Kiwi',
        email: kiwiEmail,
        ref: kiwiRef,
        picture: null,
        access: null,
        parentAccess: null,
        isMember: true,
      }, {
        id: 3,
        name: 'Charon',
        email: charonEmail,
        ref: charonRef,
        picture: null,
        access: null,
        parentAccess: "viewers",
        isMember: true,
      }]
    });

    // Fetch org permissions and check that Kiwi is a member.
    const kiwiOrgAccess = await axios.get(`${homeUrl}/api/orgs/${oid}/access`, chimpy);
    assert.equal(kiwiOrgAccess.status, 200);
    assert.deepEqual(kiwiOrgAccess.data, {
      users: [{
        id: 1,
        name: 'Chimpy',
        email: chimpyEmail,
        ref: chimpyRef,
        picture: null,
        access: "owners",
        isMember: true,
      }, {
        id: 2,
        name: 'Kiwi',
        email: kiwiEmail,
        ref: kiwiRef,
        picture: null,
        access: "members",
        isMember: true,
      }, {
        id: 3,
        name: 'Charon',
        email: charonEmail,
        ref: charonRef,
        picture: null,
        access: "viewers",
        isMember: true,
      }]
    });

    // Unset Kiwi as a member of org 'Chimpyland'.
    const removeKiwiFromOrg = await axios.patch(`${homeUrl}/api/orgs/${oid}/access`,
      {delta: removeDelta}, chimpy);
    assert.equal(removeKiwiFromOrg.status, 200);

    // Assert that updating a workspace user to "members" throws with status 400.
    const invalidResp1 = await axios.patch(`${homeUrl}/api/workspaces/${wid}/access`,
      {delta: addDelta}, chimpy);
    assert.equal(invalidResp1.status, 400);

    // Assert that updating a doc user to "members" throws with status 400.
    const invalidResp2 = await axios.patch(`${homeUrl}/api/docs/${did}/access`,
      {delta: addDelta}, chimpy);
    assert.equal(invalidResp2.status, 400);

    // Assert that updating the maxInheritedRole to "members" throws with status 400.
    const invalidDelta = { maxInheritedRole: "members" };
    const invalidResp3 = await axios.patch(`${homeUrl}/api/workspaces/${wid}/access`,
      {delta: invalidDelta}, chimpy);
    assert.equal(invalidResp3.status, 400);
  });

  describe('team plan', function() {
    let nasaOrg: Organization;
    let oldProduct: Product;

    before(async function() {
      // Set NASA to be specifically on a team plan, with team plan restrictions.
      const db = dbManager.connection.manager;
      nasaOrg = (await db.findOne(Organization, {where: {domain: 'nasa'},
                                                 relations: ['billingAccount',
                                                             'billingAccount.product']}))!;
      oldProduct = nasaOrg.billingAccount.product;
      nasaOrg.billingAccount.product = (await db.findOne(Product, {where: {name: 'team'}}))!;
      await nasaOrg.billingAccount.save();
    });

    after(async function() {
      nasaOrg.billingAccount.product = oldProduct;
      await nasaOrg.billingAccount.save();
    });

    it('should prevent adding non-org-members to workspaces', async function() {
      // Add Kiwi to Horizon
      const horizonWs = await dbManager.testGetId('Horizon');
      const addDelta = {
        users: {[kiwiEmail]: 'viewers'}
      };
      const errorResp = await axios.patch(`${homeUrl}/api/workspaces/${horizonWs}/access`,
                                          {delta: addDelta}, chimpy);
      assert.equal(errorResp.status, 403);
      assert.equal(errorResp.data.error, 'No external workspace shares permitted');
    });

    it('should prevent adding more than n non-org-members to docs', async function() {
      // Add Kiwi to Apathy
      const apathyDoc = await dbManager.testGetId('Apathy');
      let resp = await axios.patch(`${homeUrl}/api/docs/${apathyDoc}/access`,
                                   {delta: {users: {[kiwiEmail]: 'viewers'}}}, chimpy);
      assert.equal(resp.status, 200);

      // Add Support to Apathy, should not count
      resp = await axios.patch(`${homeUrl}/api/docs/${apathyDoc}/access`,
                               {delta: {users: {[supportEmail]: 'viewers'}}}, chimpy);
      assert.equal(resp.status, 200);

      // Add Ella to Apathy
      resp = await axios.patch(`${homeUrl}/api/docs/${apathyDoc}/access`,
                               {delta: {users: {'ella@getgrist.com': 'editors'}}}, chimpy);
      assert.equal(resp.status, 200);

      // Add Charon to Apathy
      resp = await axios.patch(`${homeUrl}/api/docs/${apathyDoc}/access`,
                               {delta: {users: {[charonEmail]: 'viewers'}}}, chimpy);
      assert.equal(resp.status, 403);
      assert.equal(resp.data.error, 'No more external document shares permitted');

      // Remove added users
      const removeDelta = {
        users: {
          [kiwiEmail]: null,
          [supportEmail]: null,
        }
      };
      resp = await axios.patch(`${homeUrl}/api/docs/${apathyDoc}/access`,
                               {delta: removeDelta}, chimpy);
      assert.equal(resp.status, 200);
    });
  });

  it('should emit userChange events when expected', async function() {
    // Change org permissions ==>
    const fishOrgId = await dbManager.testGetId('Fish');

    // Remove charon and kiwi from org
    const removeCharonKiwi = {
      users: { [charonEmail]: null, [kiwiEmail]: null }
    };
    const fishResp1 = await axios.patch(`${homeUrl}/api/orgs/${fishOrgId}/access`,
      {delta: removeCharonKiwi}, chimpy);
    assert.equal(fishResp1.status, 200);
    assert.deepEqual(userCountUpdates[fishOrgId as number], [1]);

    // Re-add charon
    const addCharon = {
      users: { [charonEmail]: 'viewers' }
    };
    const fishResp2 = await axios.patch(`${homeUrl}/api/orgs/${fishOrgId}/access`,
      {delta: addCharon}, chimpy);
    assert.equal(fishResp2.status, 200);
    assert.deepEqual(userCountUpdates[fishOrgId as number], [1, 2]);

    // Re-add kiwi
    const addKiwi = {
      users: { [kiwiEmail]: 'editors' }
    };
    const fishResp3 = await axios.patch(`${homeUrl}/api/orgs/${fishOrgId}/access`,
      {delta: addKiwi}, chimpy);
    assert.equal(fishResp3.status, 200);
    assert.deepEqual(userCountUpdates[fishOrgId as number], [1, 2, 3]);


    // Change workspace permissions ==>
    const clOrgId = await dbManager.testGetId('Chimpyland');
    const publicWsId = await dbManager.testGetId('Public');

    // Add charon to ws
    const publicResp1 = await axios.patch(`${homeUrl}/api/workspaces/${publicWsId}/access`,
      {delta: addCharon}, chimpy);
    assert.equal(publicResp1.status, 200);

    // Remove charon
    const removeCharon = {
      users: {[charonEmail]: null}
    };
    const publicResp2 = await axios.patch(`${homeUrl}/api/workspaces/${publicWsId}/access`,
      {delta: removeCharon}, chimpy);
    assert.equal(publicResp2.status, 200);
    // Assert that workspace user changes have no effect on userCount.
    assert.deepEqual(userCountUpdates[clOrgId as number], undefined);
  });

  it('GET /api/profile/apikey gives user\'s api key', async function() {
    const resp = await axios.get(`${homeUrl}/api/profile/apikey`, chimpy);
    assert.equal(resp.status, 200);
    assert.equal(resp.data, 'api_key_for_chimpy');
  });

  it('POST /api/profile/apiKey fails for anonymous', async function() {
    const resp = await axios.post(`${homeUrl}/api/profile/apikey`, null, nobody);
    assert.equal(resp.status, 401);
    assert.deepEqual(resp.data, {error: "user not authorized"});
  });

  it('DELETE /api/profile/apiKey fails for anonymous', async function() {
    const resp = await axios.delete(`${homeUrl}/api/profile/apikey`, nobody);
    assert.equal(resp.status, 401);
    assert.deepEqual(resp.data, {error: "user not authorized"});
  });

  it('DELETE /api/profile/apikey delete api key', async function() {
    let resp: AxiosResponse;
    resp = await axios.delete(`${homeUrl}/api/profile/apikey`, chimpy);
    assert.equal(resp.status, 200);

    // check that chimpy's apikey does not work any more
    resp = await axios.get(`${homeUrl}/api/orgs`, chimpy);
    assert.equal(resp.status, 401);
    assert.deepEqual(resp.data, "Bad request: invalid API key");

    // check that the apikey '' does not work either
    resp = await axios.get(`${homeUrl}/api/orgs`, {
      responseType: 'json',
      validateStatus: () => true,
      headers: {Authorization: "Bearer "}
    });
    assert.equal(resp.status, 401);
    assert.deepEqual(resp.data, "Bad request: invalid API key");

    // check that db encoded null for the apikey
    const chimpyUser = (await User.findOne({where: {name: 'Chimpy'}}))!;
    assert.deepEqual(chimpyUser.apiKey, null);

    // restore api key for chimpy
    chimpyUser.apiKey = 'api_key_for_chimpy';
    await chimpyUser.save();
  });

  describe('POST /api/profile/apikey', function() {
    let resp: AxiosResponse;
    it ('fails if apiKey already set', async function() {
      resp = await axios.post(`${homeUrl}/api/profile/apikey`, null, kiwi);
      assert.equal(resp.status, 400);
      assert.match(resp.data.error, /apikey is already set/);
    });

    it('succeed if apiKey already set but force flag is used', async function() {
      resp = await axios.post(`${homeUrl}/api/profile/apikey`, {force: true}, kiwi);
      assert.equal(resp.status, 200);
      const apiKey = resp.data;

      // check that old apikey does not work any more
      resp = await axios.get(`${homeUrl}/api/orgs`, kiwi);
      assert.equal(resp.status, 401);
      assert.deepEqual(resp.data, "Bad request: invalid API key");

      // check that the new api key works
      kiwi.headers = {Authorization: 'Bearer ' + apiKey};
      resp = await axios.get(`${homeUrl}/api/orgs`, kiwi);
      assert.equal(resp.status, 200);
      assert.deepEqual(resp.data.map((org: any) => org.name),
                                     ['Kiwiland', 'Fish', 'Flightless', 'Primately']);
    });

    describe('force flag is not needed if apiKey is not set', function() {
      before(function() {
        // turn off api key access for chimpy
        return dbManager.connection.query(`update users set api_key = null where name = 'Chimpy'`);
      });

      after(function() {
        // bring back api key access for chimpy
        return dbManager.connection.query(`update users set api_key = 'api_key_for_chimpy' where name = 'Chimpy'`);
      });

      it('force flag is not needed', async function() {
        // make sure api key access is off
        resp = await axios.get(`${homeUrl}/api/orgs`, chimpy);
        assert.equal(resp.status, 401);

        const cookie = await server.getCookieLogin('nasa', {email: 'chimpy@getgrist.com',
                                                            name: 'Chimpy'});

        // let's create an apikey
        resp = await axios.post(`${homeUrl}/o/nasa/api/profile/apikey`, {}, cookie);
        // check call was successful
        assert.equal(resp.status, 200);

        // check that new api key works
        chimpy.headers = {Authorization: 'Bearer ' + resp.data};
        resp = await axios.get(`${homeUrl}/api/orgs`, chimpy);
        assert.equal(resp.status, 200);
        assert.deepEqual(resp.data.map((org: any) => org.name),
          ['Chimpyland', 'EmptyOrg', 'EmptyWsOrg', 'Fish', 'Flightless',
            'FreeTeam', 'NASA', 'Primately', 'TestDailyApiLimit']);
       });
    });

    describe('generates a unique key', function() {
      let apiKeyGenerator: sinon.SinonStub;
      let apiKeyGeneratorReturns: string[];

      before(function() {
        apiKeyGenerator = sinon.stub(Deps, 'apiKeyGenerator');
        apiKeyGenerator.callsFake(() => apiKeyGeneratorReturns.shift()!);
      });

      after(function() {
        apiKeyGenerator.restore();
      });

      it('retries until the generated key is unique', async function() {
        apiKeyGeneratorReturns = ['api_key_for_charon', 'santa1'];
        resp = await axios.post(`${homeUrl}/api/profile/apikey`, {force: true}, kiwi);
        assert.equal(resp.status, 200);
        assert.equal(resp.data, 'santa1');
        assert.equal(apiKeyGenerator.callCount, 2);
        apiKeyGenerator.resetHistory();
        kiwi.headers = {Authorization: 'Bearer ' + resp.data};

        apiKeyGeneratorReturns = ['api_key_for_charon', 'api_key_for_charon', 'santa2'];
        resp = await axios.post(`${homeUrl}/api/profile/apikey`, {force: true}, kiwi);
        assert.equal(resp.status, 200);
        assert.equal(resp.data, 'santa2');
        assert.equal(apiKeyGenerator.callCount, 3);
        apiKeyGenerator.resetHistory();
        kiwi.headers = {Authorization: 'Bearer ' + resp.data};

        // after 5 attempts throws
        apiKeyGeneratorReturns = ['api_key_for_charon', 'api_key_for_charon', 'api_key_for_charon',
          'api_key_for_charon', 'api_key_for_charon', 'santa3'];
        resp = await axios.post(`${homeUrl}/api/profile/apikey`, {force: true}, kiwi);
        assert.equal(resp.status, 500);
        assert.deepEqual(resp.data, {error: 'Could not generate a valid api key.'});
      });

    });
  });
});


async function testAllowNonOwnersToRemoveThemselves(url: string) {
  // Add a viewer and an editor.
  let resp = await axios.patch(url, {
    delta: {
      users: {
        [charonEmail]: 'editors',
        [kiwiEmail]: 'viewers',
      }
    }
  }, chimpy);
  assert.equal(resp.status, 200);
  // One cannot remove the other.
  resp = await axios.patch(url, {
    delta: {
      users: {
        [kiwiEmail]: null,
      }
    }
  }, charon);
  assert.equal(resp.status, 403);
  // But they can remove themselves.
  resp = await axios.patch(url, {
    delta: {
      users: {
        [charonEmail]: null,
      }
    }
  }, charon);
  assert.equal(resp.status, 200);
  resp = await axios.patch(url, {
    delta: {
      users: {
        [kiwiEmail]: null,
      }
    }
  }, kiwi);
  assert.equal(resp.status, 200);
}
