import {Organization} from 'app/common/UserAPI';
import {assert} from 'chai';
import {TestServer} from 'test/gen-server/apiUtils';
import {setPlan} from 'test/gen-server/testUtils';
import {createTmpDir} from 'test/server/docTools';
import * as testUtils from 'test/server/testUtils';

describe('suspension', function() {
  let home: TestServer;
  let nasa: Organization;
  testUtils.setTmpLogLevel('error');

  before(async function() {
    const tmpDir = await createTmpDir();
    home = new TestServer(this);
    await home.start(["home", "docs"], {dataDir: tmpDir});
    const nasaApi = await home.createHomeApi('Chimpy', 'nasa');
    nasa = await nasaApi.getOrg('current');
  });

  after(async function() {
    await setPlan(home.dbManager, nasa, nasa.billingAccount!.product.name);
    await home.stop();
  });

  it('limits user to read-only access', async function() {
    this.timeout(4000);

    // Open nasa as chimpy (an owner)
    const nasaApi = await home.createHomeApi('Chimpy', 'nasa');
    // Set up Jupiter document to have some content
    const docId = await home.dbManager.testGetId('Jupiter') as string;
    await home.copyFixtureDoc('Hello.grist', docId);
    assert((await nasaApi.getDoc(docId)).access, 'owners');

    // Confirm that user can edit docs
    const docApi = nasaApi.getDocAPI(docId);
    await assert.isFulfilled(docApi.getRows('Table1'));
    await assert.isFulfilled(docApi.updateRows('Table1', { id: [1], A: ['v1'] }));
    await assert.isFulfilled(docApi.addRows('Table1', { A: ['v1'] }));

    // Now suspend org
    await setPlan(home.dbManager, nasa, 'suspended');

    // User should no longer be able to edit, but can view and download
    // Note a bit of cheating here: the call to getDoc() invalidates docAuthCache; without it, it
    // would be a few seconds before the change in access level is visible.
    assert((await nasaApi.getDoc(docId)).access, 'viewers');
    await assert.isFulfilled(docApi.getRows('Table1'));
    await assert.isRejected(docApi.updateRows('Table1', { id: [1], A: ['v1'] }), /No write access/);
    await assert.isRejected(docApi.addRows('Table1', { A: ['v1'] }), /No write access/);
    const worker = await nasaApi.getWorkerAPI(docId);
    assert(await worker.downloadDoc(docId));  // download still works
  });
});
