import {ApiError} from 'app/common/ApiError';
import {AssistanceRequestV1, AssistanceRequestV2} from 'app/common/Assistance';
import {Features} from 'app/common/Features';
import {resetOrg} from 'app/common/resetOrg';
import {UserAPI, UserAPIImpl} from 'app/common/UserAPI';
import {BillingAccount} from 'app/gen-server/entity/BillingAccount';
import {Limit} from 'app/gen-server/entity/Limit';
import {Organization} from 'app/gen-server/entity/Organization';
import {Product} from 'app/gen-server/entity/Product';
import {HomeDBManager} from 'app/gen-server/lib/homedb/HomeDBManager';
import {GristObjCode} from 'app/plugin/GristData';
import {assert} from 'chai';
import { IOptions } from 'app/common/BaseAPI';
import FormData from 'form-data';
import fetch from 'node-fetch';
import {TestServer} from 'test/gen-server/apiUtils';
import {configForUser, createUser} from 'test/gen-server/testUtils';
import * as testUtils from 'test/server/testUtils';

describe('limits', function() {
  let home: TestServer;
  let dbManager: HomeDBManager;
  let homeUrl: string;
  let product: Product;
  let api: UserAPI;
  let nasa: UserAPI;
  let billingId: number;
  let oldEnv: testUtils.EnvironmentSnapshot;

  testUtils.setTmpLogLevel('error');

  this.timeout('10s');

  before(async function() {
    oldEnv = new testUtils.EnvironmentSnapshot();
    process.env.OPENAI_API_KEY = "test";

    home = new TestServer(this);
    await home.start(["home", "docs"]);

    dbManager = home.dbManager;
    homeUrl = home.serverUrl;

    // Create a test product
    product = new Product();
    product.name = "test_product";
    product.features = {workspaces: true};
    await product.save();
    // Create a new user
    const samHome = await createUser(dbManager, 'sam');
    // Overwrite default product
    billingId = samHome.billingAccount.id;
    await dbManager.connection.createQueryBuilder()
      .update(BillingAccount)
      .set({product})
      .where('id = :billingId', {billingId})
      .execute();
    // Set up an api object tied to the user's personal org
    api = new UserAPIImpl(`${homeUrl}/o/docs`, {
      fetch: fetch as any,
      newFormData: () => new FormData() as any,
      ...configForUser('sam') as IOptions
    });
    // Give chimpy access to this org
    await api.updateOrgPermissions('current', {users: {'chimpy@getgrist.com': 'owners'}});
    // Set up an api object tied to nasa
    nasa = new UserAPIImpl(`${homeUrl}/o/nasa`, {
      fetch: fetch as any,
      ...configForUser('chimpy') as IOptions
    });
  });

  after(async function() {
    await home.stop();
    oldEnv.restore();
  });

  async function setFeatures(features: Features) {
    product.features = features;
    await product.save();
  }

  it('can enforce limits on number of workspaces', async function() {
    await setFeatures({maxWorkspacesPerOrg: 2, workspaces: true});

    // initially have just one workspace, the default workspace
    // created for a new personal org.
    assert.lengthOf(await api.getOrgWorkspaces('current'), 1);
    await assert.isFulfilled(api.newWorkspace({name: 'work2'}, 'current'));
    await assert.isRejected(api.newWorkspace({name: 'work3'}, 'current'),
                            /No more workspaces/);

    await setFeatures({maxWorkspacesPerOrg: 3, workspaces: true});
    await assert.isFulfilled(api.newWorkspace({name: 'work3'}, 'current'));
    await assert.isRejected(api.newWorkspace({name: 'work4'}, 'current'),
                            /No more workspaces/);

    await setFeatures({workspaces: true});
    await assert.isFulfilled(api.newWorkspace({name: 'work4'}, 'current'));

    await setFeatures({maxWorkspacesPerOrg: 1, workspaces: true});
    await assert.isRejected(api.newWorkspace({name: 'work5'}, 'current'),
                            /No more workspaces/);
  });

  it('can enforce limits on number of workspace shares', async function() {
    this.timeout(4000);
    await setFeatures({maxSharesPerWorkspace: 3, workspaces: true});
    const wsId = await api.newWorkspace({name: 'work'}, 'docs');

    // Adding 4 users would exceed 3 user limit
    await assert.isRejected(api.updateWorkspacePermissions(wsId, {
      users: {
        'user1@getgrist.com': 'owners',
        'user2@getgrist.com': 'viewers',
        'user3@getgrist.com': 'owners',
        'user4@getgrist.com': 'viewers',
      }
    }), /No more external workspace shares/);

    // Adding 1 user is ok
    await assert.isFulfilled(api.updateWorkspacePermissions(wsId, {
      users: {'user1@getgrist.com': 'owners'}
    }));

    // Adding 2nd+3rd user is ok
    await assert.isFulfilled(api.updateWorkspacePermissions(wsId, {
      users: {
        'user2@getgrist.com': 'owners',
        'user3@getgrist.com': 'owners'
      }
    }));

    // Adding 4th user fails
    await assert.isRejected(api.updateWorkspacePermissions(wsId, {
      users: {'user4@getgrist.com': 'owners'}
    }), /No more external workspace shares/);

    // Adding support user is ok
    await assert.isFulfilled(api.updateWorkspacePermissions(wsId, {
      users: {'support@getgrist.com': 'owners'}
    }));

    // Replacing user is ok
    await assert.isFulfilled(api.updateWorkspacePermissions(wsId, {
      users: {
        'user2@getgrist.com': null,
        'user2b@getgrist.com': 'owners'
      }
    }));

    // Removing a user and adding another is ok
    await assert.isFulfilled(api.updateWorkspacePermissions(wsId, {
      users: {'user1@getgrist.com': null}
    }));
    await assert.isFulfilled(api.updateWorkspacePermissions(wsId, {
      users: {'user1b@getgrist.com': 'owners'}
    }));
    await assert.isRejected(api.updateWorkspacePermissions(wsId, {
      users: {'user5@getgrist.com': 'owners'}
    }), /No more external workspace shares/);

    // Reduce to limit to allow just one share
    await setFeatures({maxSharesPerWorkspace: 1, workspaces: true});

    // Cannot add or replace users, since we are over limit
    await assert.isRejected(api.updateWorkspacePermissions(wsId, {
      users: {
        'user3@getgrist.com': null,
        'user3b@getgrist.com': 'owners'
      }
    }), /No more external workspace shares/);

    // Can remove a user, while still being over limit
    await assert.isFulfilled(api.updateWorkspacePermissions(wsId, {
      users: {'user1b@getgrist.com': null}
    }));
    await assert.isFulfilled(api.updateWorkspacePermissions(wsId, {
      users: {'user2b@getgrist.com': null}
    }));
    await assert.isFulfilled(api.updateWorkspacePermissions(wsId, {
      users: {'user3@getgrist.com': null}
    }));

    // Finally ok to add a user again
    await assert.isFulfilled(api.updateWorkspacePermissions(wsId, {
      users: {'user1@getgrist.com': 'owners'}
    }));
  });

  it('can enforce limits on number of docs', async function() {
    await setFeatures({maxDocsPerOrg: 2, workspaces: true});
    const wsId = await api.newWorkspace({name: 'work'}, 'docs');

    await assert.isFulfilled(api.newDoc({name: 'doc1'}, wsId));
    await assert.isFulfilled(api.newDoc({name: 'doc2'}, wsId));
    await assert.isRejected(api.newDoc({name: 'doc3'}, wsId), /No more documents/);

    await setFeatures({maxDocsPerOrg: 3, workspaces: true});
    await assert.isFulfilled(api.newDoc({name: 'doc3'}, wsId));
    await assert.isRejected(api.newDoc({name: 'doc4'}, wsId), /No more documents/);

    await setFeatures({workspaces: true});
    await assert.isFulfilled(api.newDoc({name: 'doc4'}, wsId));

    await setFeatures({maxDocsPerOrg: 1, workspaces: true});
    await assert.isRejected(api.newDoc({name: 'doc5'}, wsId), /No more documents/);

    // check that smuggling in a document from another org doesn't work.
    await assert.isRejected(nasa.moveDoc(await dbManager.testGetId('Jupiter') as string, wsId),
                            /No more documents/);

    // now make space for the document and try again.
    await setFeatures({maxDocsPerOrg: 6, workspaces: true});
    await assert.isFulfilled(nasa.moveDoc(await dbManager.testGetId('Jupiter') as string, wsId));

    // add a document in a workspace we are then going to make inaccessible.
    const wsHiddenId = await api.newWorkspace({name: 'hidden'}, 'docs');
    await assert.isFulfilled(api.newDoc({name: 'doc6'}, wsHiddenId));
    await assert.isRejected(api.newDoc({name: 'doc7'}, wsHiddenId), /No more documents/);

    // transfer workspace ownership, and make inaccessible.
    await api.updateWorkspacePermissions(wsHiddenId, {users: {'charon@getgrist.com': 'owners'}});
    const charon = await home.createHomeApi('charon', 'docs', true);
    await charon.updateWorkspacePermissions(wsHiddenId, {maxInheritedRole: null});

    // now try adding a document and make sure it is denied.
    await assert.isRejected(api.newDoc({name: 'doc7'}, wsId), /No more documents/);

    // clean up workspace.
    await charon.deleteWorkspace(wsHiddenId);
  });

  it('can enforce limits on number of doc shares', async function() {
    // This can exceed the default of 2s on Jenkins
    // - Changed from 4s to 8s on 2024-10-04
    this.timeout('8s');

    await setFeatures({maxSharesPerDoc: 3, workspaces: true});
    const wsId = await api.newWorkspace({name: 'shares'}, 'docs');
    const docId = await api.newDoc({name: 'doc'}, wsId);

    // Adding 4 users would exceed 3 user limit
    await assert.isRejected(api.updateDocPermissions(docId, {
      users: {
        'user1@getgrist.com': 'owners',
        'user2@getgrist.com': 'viewers',
        'user3@getgrist.com': 'owners',
        'user4@getgrist.com': 'viewers',
      }
    }), /No more external document shares/);

    // Adding 1 user is ok
    await assert.isFulfilled(api.updateDocPermissions(docId, {
      users: {'user1@getgrist.com': 'owners'}
    }));

    // Adding 2nd+3rd user is ok
    await assert.isFulfilled(api.updateDocPermissions(docId, {
      users: {
        'user2@getgrist.com': 'owners',
        'user3@getgrist.com': 'owners'
      }
    }));

    // Adding 4th user fails
    await assert.isRejected(api.updateDocPermissions(docId, {
      users: {'user4@getgrist.com': 'owners'}
    }), /No more external document shares/);

    // Adding support user is ok
    await assert.isFulfilled(api.updateDocPermissions(docId, {
      users: {'support@getgrist.com': 'owners'}
    }));

    // Replacing user is ok
    await assert.isFulfilled(api.updateDocPermissions(docId, {
      users: {
        'user2@getgrist.com': null,
        'user2b@getgrist.com': 'owners'
      }
    }));

    // Removing a user and adding another is ok
    await assert.isFulfilled(api.updateDocPermissions(docId, {
      users: {'user1@getgrist.com': null}
    }));
    await assert.isFulfilled(api.updateDocPermissions(docId, {
      users: {'user1b@getgrist.com': 'owners'}
    }));
    await assert.isRejected(api.updateDocPermissions(docId, {
      users: {'user5@getgrist.com': 'owners'}
    }), /No more external document shares/);

    // Reduce to limit to allow just one share
    await setFeatures({maxSharesPerDoc: 1, workspaces: true});

    // Cannot add or replace users, since we are over limit
    await assert.isRejected(api.updateDocPermissions(docId, {
      users: {
        'user3@getgrist.com': null,
        'user3b@getgrist.com': 'owners'
      }
    }), /No more external document shares/);

    // Can remove a user, while still being over limit
    await assert.isFulfilled(api.updateDocPermissions(docId, {
      users: {'user1b@getgrist.com': null}
    }));
    await assert.isFulfilled(api.updateDocPermissions(docId, {
      users: {'user2b@getgrist.com': null}
    }));
    await assert.isFulfilled(api.updateDocPermissions(docId, {
      users: {'user3@getgrist.com': null}
    }));

    // Finally ok to add a user again
    await assert.isFulfilled(api.updateDocPermissions(docId, {
      users: {'user1@getgrist.com': 'owners'}
    }));

    // Try smuggling in a doc that breaks the rules
    // Tweak NASA's product to allow 4 shares per doc.
    const db = dbManager.connection.manager;
    const nasaOrg = await db.findOne(Organization, {where: {domain: 'nasa'},
                                                    relations: ['billingAccount',
                                                                'billingAccount.product']});
    if (!nasaOrg) { throw new Error('could not find nasa org'); }
    const nasaProduct = nasaOrg.billingAccount.product;
    const originalFeatures = nasaProduct.features;

    nasaProduct.features = {...originalFeatures, maxSharesPerDoc: 4};
    await nasaProduct.save();

    const pluto = await dbManager.testGetId('Pluto') as string;
    await nasa.updateDocPermissions(pluto, {
      users: {
        'zig@getgrist.com': 'owners',
        'zag@getgrist.com': 'editors',
        'zog@getgrist.com': 'viewers',
      }
    });
    await assert.isRejected(nasa.moveDoc(pluto, wsId), /Too many external document shares/);

    // Increase the limit and try again
    await setFeatures({maxSharesPerDoc: 100, workspaces: true});
    await assert.isFulfilled(nasa.moveDoc(pluto, wsId));
  });

  it('can enforce limits on number of doc shares per role', async function() {
    this.timeout(4000);      // This can exceed the default of 2s on Jenkins

    await setFeatures({maxSharesPerDoc: 10,
                       maxSharesPerDocPerRole: {
                         owners: 1,
                         editors: 2
                       },
                       workspaces: true});
    const wsId = await api.newWorkspace({name: 'roleShares'}, 'docs');
    const docId = await api.newDoc({name: 'doc'}, wsId);

    // can add plenty of viewers
    await assert.isFulfilled(api.updateDocPermissions(docId, {
      users: {
        'viewer1@getgrist.com': 'viewers',
        'viewer2@getgrist.com': 'viewers',
        'viewer3@getgrist.com': 'viewers',
        'viewer4@getgrist.com': 'viewers'
      }
    }));

    // can add just one owner
    await assert.isFulfilled(api.updateDocPermissions(docId, {
      users: {'owner1@getgrist.com': 'owners'}
    }));
    await assert.isRejected(api.updateDocPermissions(docId, {
      users: {'owner2@getgrist.com': 'owners'}
    }), /No more external document owners/);

    // can add at most two editors
    await assert.isRejected(api.updateDocPermissions(docId, {
      users: {
        'editor1@getgrist.com': 'editors',
        'editor2@getgrist.com': 'editors',
        'editor3@getgrist.com': 'editors'
      }
    }), /No more external document editors/);
    await assert.isFulfilled(api.updateDocPermissions(docId, {
      users: {
        'editor1@getgrist.com': 'editors',
        'editor2@getgrist.com': 'editors'
      }
    }));

    // can convert an editor to a viewer and then add another editor
    await assert.isFulfilled(api.updateDocPermissions(docId, {
      users: {
        'editor1@getgrist.com': 'viewers',
        'editor3@getgrist.com': 'editors'
      }
    }));

    // we are at 8 shares, can make just two more
    await assert.isFulfilled(api.updateDocPermissions(docId, {
      users: {'viewer5@getgrist.com': 'viewers'}
    }));
    await assert.isFulfilled(api.updateDocPermissions(docId, {
      users: {'viewer6@getgrist.com': 'viewers'}
    }));
    await assert.isRejected(api.updateDocPermissions(docId, {
      users: {'viewer7@getgrist.com': 'viewers'}
    }), /No more external document shares/);


    // Try smuggling in a doc that exceeds limits
    const beyond = await dbManager.testGetId('Beyond') as string;
    await nasa.updateDocPermissions(beyond, {
      users: {
        'zig@getgrist.com': 'owners',
        'zag@getgrist.com': 'owners'
      }
    });
    await assert.isRejected(nasa.moveDoc(beyond, wsId), /Too many external document owners/);

    // Increase the limit and try again
    await setFeatures({maxSharesPerDoc: 10,
                       maxSharesPerDocPerRole: {
                         owners: 2,
                         editors: 2
                       },
                       workspaces: true});
    await assert.isFulfilled(nasa.moveDoc(beyond, wsId));
  });

  it('can give good tips when exceeding doc shares', async function() {
    await setFeatures({maxSharesPerDoc: 2, workspaces: true});
    const wsId = await api.newWorkspace({name: 'shares'}, 'docs');
    const docId = await api.newDoc({name: 'doc'}, wsId);

    await assert.isFulfilled(api.updateDocPermissions(docId, {
      users: {
        'user1@getgrist.com': 'owners',
        'user2@getgrist.com': 'viewers',
      }
    }));
    let err: ApiError = await api.updateDocPermissions(docId, {
      users: {
        'user3@getgrist.com': 'owners',
      }
    }).catch(e => e);
    // Advice should be to add users as members.
    assert.sameMembers(err.details!.tips!.map(tip => tip.action), ['add-members']);

    // Now switch to a product that looks like a personal site
    await setFeatures({maxSharesPerDoc: 2, workspaces: true, maxWorkspacesPerOrg: 1});
    err = await api.updateDocPermissions(docId, {
      users: {
        'user3@getgrist.com': 'owners',
      }
    }).catch(e => e);
    // Advice should be to upgrade.
    assert.sameMembers(err.details!.tips!.map(tip => tip.action), ['upgrade']);
  });

  it('can give good tips when exceeding workspace shares', async function() {
    await setFeatures({maxSharesPerWorkspace: 2, workspaces: true});
    const wsId = await api.newWorkspace({name: 'shares'}, 'docs');

    await assert.isFulfilled(api.updateWorkspacePermissions(wsId, {
      users: {
        'user1@getgrist.com': 'owners',
        'user2@getgrist.com': 'viewers',
      }
    }));
    let err: ApiError = await api.updateWorkspacePermissions(wsId, {
      users: {
        'user3@getgrist.com': 'owners',
      }
    }).catch(e => e);
    // Advice should be to add users as members.
    assert.sameMembers(err.details!.tips!.map(tip => tip.action), ['add-members']);

    // Now switch to a product that looks like a personal site (it should not
    // be possible to share workspaces via UI in this case though)
    await setFeatures({maxSharesPerWorkspace: 0, workspaces: true, maxWorkspacesPerOrg: 1});
    err = await api.updateWorkspacePermissions(wsId, {
      users: {
        'user3@getgrist.com': 'owners',
      }
    }).catch(e => e);
    // Advice should be to upgrade.
    assert.sameMembers(err.details!.tips!.map(tip => tip.action), ['upgrade']);
  });

  it('discounts deleted and soft-deleted documents from quota', async function() {
    this.timeout(3000);      // This can exceed the default of 2s on Jenkins

    // Reset org to contain no docs, and set limit on docs to 2
    await resetOrg(api, 'docs');
    await setFeatures({maxDocsPerOrg: 2, workspaces: true});
    const wsId = await api.newWorkspace({name: 'work'}, 'docs');

    // Create 2 docs.  Then creating another will fail.
    const doc1 = await api.newDoc({name: 'doc1'}, wsId);
    const doc2 = await api.newDoc({name: 'doc2'}, wsId);
    await assert.isRejected(api.newDoc({name: 'doc3'}, wsId), /No more documents/);

    // Hard-delete one doc, then we can add another.
    await api.deleteDoc(doc1);
    const doc3 = await api.newDoc({name: 'doc3'}, wsId);

    // Soft-delete one doc, then we can add another.
    await api.softDeleteDoc(doc2);
    await api.newDoc({name: 'doc4'}, wsId);

    // Check we can neither create nor recover a doc when full again.
    await assert.isRejected(api.newDoc({name: 'doc5'}, wsId), /No more documents/);
    await assert.isRejected(api.undeleteDoc(doc2), /No more documents/);

    // Check that if we make some space we can recover a doc.
    await api.softDeleteDoc(doc3);
    await api.undeleteDoc(doc2);
  });

  it('can enforce limits on total attachment file size', async function() {
    this.timeout(4000);

    // Each attachment in this test will have one byte, so essentially we're limiting to two attachments
    await setFeatures({baseMaxAttachmentsBytesPerDocument: 2});

    const workspaces = await api.getOrgWorkspaces('current');
    const docId = await api.newDoc({name: 'doc1'}, workspaces[0].id);
    await api.applyUserActions(docId, [["ModifyColumn", "Table1", "A", {type: "Attachments"}]]);
    const docApi = api.getDocAPI(docId);

    // Add a cell referencing the attachments we're about to create.
    // This ensures that they won't be immediately treated as soft-deleted and ignored in the total size calculation.
    // Otherwise the uploads after this would succeed even if duplicate attachments were counted twice.
    const rowIds = await docApi.addRows("Table1", {A: [[GristObjCode.List, 1, 2, 3]]});
    assert.deepEqual(rowIds, [1]);

    // We're limited to 2 attachments, but the attachment 'a' is duplicated so it's only counted once.
    const attachmentIds = [
      await docApi.uploadAttachment('a', 'a.txt'),
      await docApi.uploadAttachment('a', 'a.txt'),
      await docApi.uploadAttachment('b', 'b.txt'),
    ];
    assert.deepEqual(attachmentIds, [1, 2, 3]);

    // Now we're at the limit and trying to upload another attachment is rejected.
    await assert.isRejected(docApi.uploadAttachment('c', 'c.txt'));

    // Delete one reference to 'a', but there's still another one so we're still at the limit and can't upload more.
    await docApi.updateRows("Table1", {id: rowIds, A: [[GristObjCode.List, 2, 3]]});
    await assert.isRejected(docApi.uploadAttachment('c', 'c.txt'));

    // Delete the other reference to 'a' so now there's only one referenced attachment 'b' and we can upload again.
    await docApi.updateRows("Table1", {id: rowIds, A: [[GristObjCode.List, 3, 4]]});
    assert.equal(await docApi.uploadAttachment('c', 'c.txt'), 4);

    // Now we're at the limit again with 'b' and 'c' and can't upload further.
    await assert.isRejected(docApi.uploadAttachment('d', 'd.txt'));
  });

  it('can enforce limits on assistant usage', async function() {
    const setLimit = async (limit: number | undefined) => {
      await setFeatures({baseMaxAssistantCalls: limit});
      if (limit !== undefined) {
        await dbManager.connection.createQueryBuilder()
          .update(Limit)
          .set({limit})
          .where('billing_account_id = :billingId', {billingId})
          .execute();
      }
    };

    const sendAndAssert = async ({fulfilled}: {fulfilled: boolean}) => {
      const version = home.server.getAssistant()?.version;
      const sharedPayload = {
        conversationId: 'id',
        text: 'text',
      };
      const v1: AssistanceRequestV1 = {
        ...sharedPayload,
        context: {
          tableId: '',
          colId: '',
        }
      };
      const v2: AssistanceRequestV2 = {
        ...sharedPayload,
        context: {}
      };
      const response = docApi.getAssistance(version === 1 ? v1 : v2);
      if (fulfilled) {
        await assert.isFulfilled(response);
      } else {
        await assert.isRejected(response);
      }
    };

    const workspaces = await api.getOrgWorkspaces('current');
    const docId = await api.newDoc({name: 'doc2'}, workspaces[0].id);
    const docApi = api.getDocAPI(docId);

    await setLimit(0);
    await sendAndAssert({fulfilled: false});

    await setLimit(2);
    await sendAndAssert({fulfilled: true});
    await sendAndAssert({fulfilled: true});
    await sendAndAssert({fulfilled: false});

    await setLimit(undefined);
    await sendAndAssert({fulfilled: true});
  });
});
