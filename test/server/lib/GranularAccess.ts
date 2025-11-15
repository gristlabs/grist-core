import {LocalActionBundle, SandboxActionBundle} from 'app/common/ActionBundle';
import {PermissionDataWithExtraUsers} from 'app/common/ActiveDocAPI';
import {delay} from 'app/common/delay';
import {
  AddRecord,
  BulkAddRecord,
  BulkRemoveRecord,
  BulkUpdateRecord,
  CellValue,
  DocAction,
  RemoveRecord,
  ReplaceTableData,
  TableColValues,
  TableDataAction,
  UpdateRecord
} from 'app/common/DocActions';
import {OpenDocOptions} from 'app/common/DocListAPI';
import {SHARE_KEY_PREFIX} from 'app/common/gristUrls';
import {isLongerThan, pruneArray} from 'app/common/gutil';
import {UserAPI, UserAPIImpl} from 'app/common/UserAPI';
import {GristObjCode} from 'app/plugin/GristData';
import {Deps as DocClientsDeps} from 'app/server/lib/DocClients';
import {DocManager} from 'app/server/lib/DocManager';
import {docSessionFromRequest, makeExceptionalDocSession} from 'app/server/lib/DocSession';
import {filterColValues, GranularAccess} from 'app/server/lib/GranularAccess';
import {globalUploadSet} from 'app/server/lib/uploads';
import {assert} from 'chai';
import {cloneDeep, isMatch, pick} from 'lodash';
import * as sinon from 'sinon';
import {TestServer} from 'test/gen-server/apiUtils';
import {createDocTools} from 'test/server/docTools';
import {GristClient, openClient} from 'test/server/gristClient';
import * as testUtils from 'test/server/testUtils';

describe('GranularAccess', function() {
  this.timeout(60000);
  let home: TestServer;
  testUtils.setTmpLogLevel('error');
  let owner: UserAPI;
  let editor: UserAPI;
  let docId: string;
  let wsId: number;
  let cliOwner: GristClient;
  let cliEditor: GristClient;
  let docManager: DocManager;
  let oldEnv: testUtils.EnvironmentSnapshot;
  const docTools = createDocTools();
  const sandbox = sinon.createSandbox();

  async function getWebsocket(api: UserAPI) {
    const who = await api.getSessionActive();
    return openClient(home.server, who.user.email, who.org?.domain || 'docs');
  }

  /**
   * Add some actions directly into document history, so they can be used as an undo.
   */
  async function addFakeBundle(actions: DocAction[],
                               options?: {
                                 user?: string,
                                 time?: number,
                               }) {
    const doc = await docManager.getActiveDoc(docId);
    const history = doc?.getActionHistory();
    const actionNum = fakeActionNum;
    const actionHash = String(fakeActionNum);
    fakeActionNum++;
    const bundle: LocalActionBundle = {
      actionNum,
      actionHash,
      parentActionHash: null,
      userActions: actions,
      undo: actions,
      info: [0, {time: Date.now(), ...options} as any],
      stored: [],
      calc: [],
      envelopes: []
    };
    await history?.recordNextShared(bundle);
    return { actionNum, actionHash };
  }
  let fakeActionNum = 10000;

  /**
   * Apply actions as a fake undo, inserting them in history and then activating
   * them from there.
   */
  async function applyAsUndo(client: GristClient, actions: DocAction[],
                             options?: {
                               user?: string,
                               time?: number,
                             }) {
    const {actionNum, actionHash} = await addFakeBundle(actions, options);
    const result = await client.send("applyUserActionsById", 0, [actionNum], [actionHash], true);
    return result;
  }

  async function getShareKeyForUrl(linkId: string) {
    const shares = await home.dbManager.connection.query(
      'select * from shares where link_id = ?', [linkId]);
    const key = shares[0].key;
    if (!key) {
      throw new Error('cannot find share key');
    }
    return `${SHARE_KEY_PREFIX}${key}`;
  }

  async function removeShares(sharingDocId: string, api: UserAPI) {
    const shares = await owner.getDocAPI(sharingDocId).getRecords('_grist_Shares');
    for (const share of shares) {
      await api.applyUserActions(docId, [
        ['RemoveRecord', '_grist_Shares', share.id]
      ]);
    }
  }

  before(async function() {
    oldEnv = new testUtils.EnvironmentSnapshot();
    home = new TestServer(this);
    process.env.GRIST_DEFAULT_EMAIL = 'ham@getgrist.com';
    await home.start(['home', 'docs']);
    const api = await home.createHomeApi('chimpy', 'docs', true);
    await api.newOrg({name: 'testy', domain: 'testy'});
    owner = await home.createHomeApi('chimpy', 'testy', true);
    wsId = await owner.newWorkspace({name: 'ws'}, 'current');
    await owner.updateWorkspacePermissions(wsId, {
      users: {
        'kiwi@getgrist.com': 'owners',
        'charon@getgrist.com': 'editors',
      }
    });
    editor = await home.createHomeApi('charon', 'testy', true);
    docManager = (home.server as any)._docManager;
  });

  after(async function() {
    const api = await home.createHomeApi('chimpy', 'docs');
    await api.deleteOrg('testy');
    await home.stop();
    await globalUploadSet.cleanupAll();
    oldEnv.restore();
  });

  afterEach(async function() {
    if (docId) {
      for (const cli of [cliEditor, cliOwner]) {
        await closeClient(cli);
      }
      docId = "";
    }
    sandbox.restore();
  });

  async function getGranularAccess(): Promise<GranularAccess> {
    const doc = await docManager.getActiveDoc(docId);
    return (doc as any)._granularAccess;
  }

  async function freshDoc(fixture?: string) {
    docId = await owner.newDoc({name: 'doc'}, wsId);
    if (fixture) {
      await home.copyFixtureDoc(fixture, docId);
      await owner.getDocAPI(docId).forceReload();
    }
    cliEditor = await getWebsocket(editor);
    cliOwner = await getWebsocket(owner);
    try {
      await cliEditor.openDocOnConnect(docId);
      await cliOwner.openDocOnConnect(docId);
    } catch (_e) {
      // doc may be unusable
    }
  }

  // Reopen clients in a different mode (e.g. default vs fork), or in a different order
  // (editor first or owner first).
  async function reopenClients(options?: OpenDocOptions & {
    first?: 'owner' | 'editor' | 'any',
  }) {
    cliEditor.flush();
    cliOwner.flush();
    await cliEditor.send("closeDoc", 0);
    await cliOwner.send("closeDoc", 0);
    const order = options?.first === 'owner' ? [cliOwner, cliEditor] : [cliEditor, cliOwner];
    await order[0].send("openDoc", docId, options);
    if (options?.first && options.first !== 'any') {
      await delay(250);
    }
    await order[1].send("openDoc", docId, options);
  }

  // See the comment in PermissionInfo.ts/evaluateRule() for why we need this.
  describe("forces a row check for rules with memo and rec", function() {

    it('for -U permission', async function() {
      await memoDoc();
      await owner.applyUserActions(docId, [
        ['AddRecord', '_grist_ACLResources', -2, {tableId: 'Table1', colIds: '*'}],
        ['AddRecord', '_grist_ACLRules', null, {
          resource: -2, aclFormula: 'user.Access == OWNER', permissionsText: 'all',  // Owner can do anything
        }],
        ['AddRecord', '_grist_ACLRules', null, {
          resource: -2, aclFormula: 'rec.A == 1', permissionsText: '-U'
        }],
        ['AddRecord', '_grist_ACLRules', null, {
          resource: -2, aclFormula: 'rec.A == 2', permissionsText: '-U', memo: 'Cant2',  // Can't update 2
        }],
        ['AddRecord', '_grist_ACLRules', null, {
          resource: -2, aclFormula: 'rec.A == 3', permissionsText: '-U', memo: 'Cant3',  // Can't update 3
        }],
        ['AddRecord', '_grist_ACLRules', null, {
          resource: -2, aclFormula: '', permissionsText: '-U',  // Actually can't update anything
        }],
      ]);

      // Make sure we see correct memo.
      await assertDeniedFor(editor.getDocAPI(docId).updateRows('Table1', {id: [1], A: [100]}), []);
      await assertDeniedFor(editor.getDocAPI(docId).updateRows('Table1', {id: [2], A: [100]}), ['Cant2']);
      await assertDeniedFor(editor.getDocAPI(docId).updateRows('Table1', {id: [3], A: [100]}), ['Cant3']);
      await assertDeniedFor(editor.getDocAPI(docId).updateRows('Table1', {id: [4], A: [100]}), []);
    });

    it('for -C permission', async function() {
      // Check atomic permission UCD
      await memoDoc();
      await owner.applyUserActions(docId, [
        ['AddRecord', '_grist_ACLResources', -1, {tableId: 'Table1', colIds: '*'}],
        ['AddRecord', '_grist_ACLRules', null, {
          resource: -1, aclFormula: 'user.Access == OWNER', permissionsText: 'all',  // Owner can do anything
        }],
        ['AddRecord', '_grist_ACLRules', null, {
          resource: -1, aclFormula: 'rec.A == 1', permissionsText: '-C' // Can't create rec.A
        }],
        ['AddRecord', '_grist_ACLRules', null, {
          resource: -1, aclFormula: 'rec.A == 2', permissionsText: '-C', memo: 'Cant2',  // Can't create rec with 2
        }],
        ['AddRecord', '_grist_ACLRules', null, {
          resource: -1, aclFormula: '', permissionsText: '-C',  // Actually can't createy anything
        }],
      ]);

      // Make sure we see correct memo.
      await assertDeniedFor(editor.getDocAPI(docId).addRows('Table1', {A: [1]}), []);
      await assertDeniedFor(editor.getDocAPI(docId).addRows('Table1', {A: [2]}), ['Cant2']);
      await assertDeniedFor(editor.getDocAPI(docId).addRows('Table1', {A: [3]}), []);
    });

    it('for -D permission', async function() {
      // Check atomic permission UCD
      await memoDoc();
      await owner.applyUserActions(docId, [
        ['AddRecord', '_grist_ACLResources', -1, {tableId: 'Table1', colIds: '*'}],
        ['AddRecord', '_grist_ACLRules', null, {
          resource: -1, aclFormula: 'user.Access == OWNER', permissionsText: 'all',  // Owner can do anything
        }],
        ['AddRecord', '_grist_ACLRules', null, {
          resource: -1, aclFormula: 'rec.A == 1', permissionsText: '-D' // Can't remove 1
        }],
        ['AddRecord', '_grist_ACLRules', null, {
          resource: -1, aclFormula: 'rec.A == 2', permissionsText: '-D', memo: 'Cant2',  // Can't remove 2 (with memo)
        }],
        ['AddRecord', '_grist_ACLRules', null, {
          resource: -1, aclFormula: '', permissionsText: '-D',  // Actually can't remove anything.
        }],
      ]);

      // Make sure we see correct memo.
      await assertDeniedFor(editor.getDocAPI(docId).removeRows('Table1', [1]), []);
      await assertDeniedFor(editor.getDocAPI(docId).removeRows('Table1', [2]), ['Cant2']);
      await assertDeniedFor(editor.getDocAPI(docId).removeRows('Table1', [3]), []);
    });

    it('for -U with mixed columns', async function() {
      // Check atomic permission UCD
      await memoDoc();
      await owner.applyUserActions(docId, [
        ['AddRecord', '_grist_ACLResources', -1, {tableId: 'Table1', colIds: 'A'}],
        ['AddRecord', '_grist_ACLRules', null, {
          resource: -1, aclFormula: 'user.Access == OWNER', permissionsText: 'all',  // Owner can do anything
        }],
        ['AddRecord', '_grist_ACLRules', null, {
          resource: -1, aclFormula: 'rec.A == 1', permissionsText: '-U' // Can't update 1
        }],
        ['AddRecord', '_grist_ACLRules', null, {
          resource: -1, aclFormula: 'rec.A == 2', permissionsText: '-U', memo: 'Cant2',  // Can't update 2 (with memo)
        }],
        ['AddRecord', '_grist_ACLRules', null, {
          resource: -1, aclFormula: 'rec.A == 3', permissionsText: '-U', memo: 'Cant3',
        }],
        ['AddRecord', '_grist_ACLRules', null, {
          resource: -1, aclFormula: '', permissionsText: '-U',  // Actually can't update this column at all.
        }],
      ]);

      // Make sure we see correct memo.
      await assertDeniedFor(editor.getDocAPI(docId).updateRows('Table1', {id: [1], A: [100]}), []);
      await assertDeniedFor(editor.getDocAPI(docId).updateRows('Table1', {id: [2], A: [100]}), ['Cant2']);
      await assertDeniedFor(editor.getDocAPI(docId).updateRows('Table1', {id: [3], A: [100]}), ['Cant3']);
      await assertDeniedFor(editor.getDocAPI(docId).updateRows('Table1', {id: [4], A: [100]}), []);

      // But B is ok to update.
      await assert.isFulfilled(editor.getDocAPI(docId).updateRows('Table1', {id: [1], B: [100]}));
      await assert.isFulfilled(editor.getDocAPI(docId).updateRows('Table1', {id: [2], B: [100]}));
      await assert.isFulfilled(editor.getDocAPI(docId).updateRows('Table1', {id: [3], B: [100]}));
      await assert.isFulfilled(editor.getDocAPI(docId).updateRows('Table1', {id: [4], B: [100]}));
    });

    it('for -U with mixed columns with default fallback', async function() {
      await memoDoc();
      await owner.applyUserActions(docId, [
        ['AddRecord', '_grist_ACLResources', -1, {tableId: 'Table1', colIds: 'A'}],
        ['AddRecord', '_grist_ACLResources', -2, {tableId: 'Table1', colIds: '*'}],
        ['AddRecord', '_grist_ACLRules', null, {
          resource: -1, aclFormula: 'user.Access == OWNER', permissionsText: 'all',  // Owner can do anything
        }],
        //######### A column rules
        ['AddRecord', '_grist_ACLRules', null, {
          resource: -1, aclFormula: 'rec.A == 1', permissionsText: '-U'
        }],
        ['AddRecord', '_grist_ACLRules', null, {
          resource: -1, aclFormula: 'rec.A == 2', permissionsText: '-U', memo: 'Cant2',  // Can't update 2 (with memo)
        }],
        ['AddRecord', '_grist_ACLRules', null, {
          resource: -1, aclFormula: 'rec.A == 3', permissionsText: '-U', memo: 'Cant3',
        }],
        // ######## Table rules (default)
        ['AddRecord', '_grist_ACLRules', null, {
          resource: -2, aclFormula: 'rec.A == 4', permissionsText: '-U', memo: 'Cant4',  // Row 4 is read only.
        }],
        ['AddRecord', '_grist_ACLRules', null, {
          resource: -2, aclFormula: '', permissionsText: '-U', memo: 'no', // Actually can't update this table at all.
        }]
      ]);

      // Make sure we see correct memo.
      await assertDeniedFor(editor.getDocAPI(docId).updateRows('Table1', {id: [1], A: [100]}), ['no']);
      await assertDeniedFor(editor.getDocAPI(docId).updateRows('Table1', {id: [2], A: [100]}), ['Cant2', 'no']);
      await assertDeniedFor(editor.getDocAPI(docId).updateRows('Table1', {id: [3], A: [100]}), ['Cant3', 'no']);
      await assertDeniedFor(editor.getDocAPI(docId).updateRows('Table1', {id: [4], A: [100]}), ['Cant4', 'no']);
      await assertDeniedFor(editor.getDocAPI(docId).updateRows('Table1', {id: [4], B: [100]}), ['Cant4', 'no']);
      await assertDeniedFor(editor.getDocAPI(docId).updateRows('Table1', {id: [5], A: [100]}), ['no']);
      await assertDeniedFor(editor.getDocAPI(docId).updateRows('Table1', {id: [5], B: [100]}), ['no']);
    });

    it('for -U with mixed columns with default fallback', async function() {
      await memoDoc();
      await owner.applyUserActions(docId, [
        ['AddRecord', '_grist_ACLResources', -1, {tableId: 'Table1', colIds: 'A'}],
        ['AddRecord', '_grist_ACLResources', -2, {tableId: 'Table1', colIds: '*'}],
        ['AddRecord', '_grist_ACLRules', null, {
          resource: -1, aclFormula: 'user.Access == OWNER', permissionsText: 'all',  // Owner can do anything
        }],
        //######### A column rules
        ['AddRecord', '_grist_ACLRules', null, {
          resource: -1, aclFormula: 'rec.A == 1', permissionsText: '-U'
        }],
        ['AddRecord', '_grist_ACLRules', null, {
          resource: -1, aclFormula: 'rec.A == 2', permissionsText: '-U'  // Can't update 2 (with memo)
        }],
        ['AddRecord', '_grist_ACLRules', null, {
          resource: -1, aclFormula: 'rec.A == 3', permissionsText: '-U'
        }],
        // ######## Table rules (default)
        ['AddRecord', '_grist_ACLRules', null, {
          resource: -2, aclFormula: 'rec.A == 4', permissionsText: '-U'  // Row 4 is read only.
        }],
        ['AddRecord', '_grist_ACLRules', null, {
          resource: -2, aclFormula: '', permissionsText: '-U', memo: 'no', // Actually can't update this table at all.
        }]
      ]);

      // Make sure we see correct memo.
      await assertDeniedFor(editor.getDocAPI(docId).updateRows('Table1', {id: [1], A: [100]}), ['no']);
      await assertDeniedFor(editor.getDocAPI(docId).updateRows('Table1', {id: [2], A: [100]}), ['no']);
      await assertDeniedFor(editor.getDocAPI(docId).updateRows('Table1', {id: [3], A: [100]}), ['no']);
      await assertDeniedFor(editor.getDocAPI(docId).updateRows('Table1', {id: [4], A: [100]}), ['no']);
      await assertDeniedFor(editor.getDocAPI(docId).updateRows('Table1', {id: [4], B: [100]}), ['no']);
      await assertDeniedFor(editor.getDocAPI(docId).updateRows('Table1', {id: [5], A: [100]}), ['no']);
      await assertDeniedFor(editor.getDocAPI(docId).updateRows('Table1', {id: [5], B: [100]}), ['no']);
    });

    it('for -U with mixed columns without default fallback', async function() {
      await memoDoc();
      await owner.applyUserActions(docId, [
        ['AddRecord', '_grist_ACLResources', -1, {tableId: 'Table1', colIds: 'A'}],
        ['AddRecord', '_grist_ACLResources', -2, {tableId: 'Table1', colIds: '*'}],
        ['AddRecord', '_grist_ACLRules', null, {
          resource: -1, aclFormula: 'user.Access == OWNER', permissionsText: 'all',  // Owner can do anything
        }],
        //######### A column rules
        ['AddRecord', '_grist_ACLRules', null, {
          resource: -1, aclFormula: 'rec.A == 1', permissionsText: '-U'
        }],
        ['AddRecord', '_grist_ACLRules', null, {
          resource: -1, aclFormula: 'rec.A == 2', permissionsText: '-U', memo: 'Cant2',  // Can't update 2 (with memo)
        }],
        ['AddRecord', '_grist_ACLRules', null, {
          resource: -1, aclFormula: 'rec.A == 3', permissionsText: '-U', memo: 'Cant3',
        }],
        // ######## Table rules (default)
        ['AddRecord', '_grist_ACLRules', null, {
          resource: -2, aclFormula: 'rec.A == 4', permissionsText: '-U', memo: 'Cant4',  // Row 4 is read only.
        }],
      ]);

      // Make sure we see correct memo.
      await assertDeniedFor(editor.getDocAPI(docId).updateRows('Table1', {id: [1], A: [100]}), []);
      await assertDeniedFor(editor.getDocAPI(docId).updateRows('Table1', {id: [2], A: [100]}), ['Cant2']);
      await assertDeniedFor(editor.getDocAPI(docId).updateRows('Table1', {id: [3], A: [100]}), ['Cant3']);
      await assertDeniedFor(editor.getDocAPI(docId).updateRows('Table1', {id: [4], A: [100]}), ['Cant4']);
      await assertDeniedFor(editor.getDocAPI(docId).updateRows('Table1', {id: [4], B: [100]}), ['Cant4']);

      await assert.isFulfilled(editor.getDocAPI(docId).updateRows('Table1', {id: [5], A: [100]}));
      await assert.isFulfilled(editor.getDocAPI(docId).updateRows('Table1', {id: [5], B: [100]}));
    });

    async function memoDoc() {
      await freshDoc();
      await owner.applyUserActions(docId, [
        ['AddTable', 'Table1', [{id: 'A', type: 'Int'}, {id: 'B', type: 'Int'}]],
        ['AddRecord', '_grist_ACLResources', -1, {tableId: '*', colIds: '*'}],
        ['AddRecord', '_grist_ACLRules', null, {
          resource: -1, aclFormula: 'user.Access != OWNER', permissionsText: '-S',  // drop schema rights
        }],
      ]);
      cliEditor.flush();
      cliOwner.flush();
      await owner.getDocAPI(docId).addRows('Table1', {A: [1, 2, 3, 4, 5]});
    }
  });

  it('hides transform columns from users without SCHEMA_EDIT when any column has rules', async () => {
    // gristHelper_Converted and gristHelper_Transform columns are special. When a document
    // has a granular access rules, those columns are hidden from users without SCHEMA_EDIT.
    await applyTransformation('B');
    // Make sure we don't see transform columns as editor.
    assert.deepEqual((await cliEditor.readDocUserAction()), [
      ['AddRecord', '_grist_Tables_column', 8, {
        isFormula: false, type: 'Any', formula: '', colId: '', widgetOptions: '',
        label: '', parentPos: 8, parentId: 0
      }],
      ['AddRecord', '_grist_Tables_column', 9, {
        isFormula: true, type: 'Any', formula: '', colId: '', widgetOptions: '',
        label: '', parentPos: 9, parentId: 0
      }],
      ['ModifyColumn', 'Table1', 'A', {type: 'Text'}],
      ['UpdateRecord', 'Table1', 1, {A: '1234' }],
      ['UpdateRecord', '_grist_Tables_column', 2, {widgetOptions: '{}', type: 'Text'}]
    ]);
  });

  it('hides transform columns from users without SCHEMA_EDIT if column has rules', async () => {
    await applyTransformation('A');
    // Make sure we don't see anything as editor (we hid column A).
    assert.deepEqual((await cliEditor.readDocUserAction()), [
      ['AddRecord', '_grist_Tables_column', 8, {
        isFormula: false, type: 'Any', formula: '', colId: '', widgetOptions: '',
        label: '', parentPos: 8, parentId: 0
      }],
      ['AddRecord', '_grist_Tables_column', 9, {
        isFormula: true, type: 'Any', formula: '', colId: '', widgetOptions: '',
        label: '', parentPos: 9, parentId: 0
      }],
      ['UpdateRecord', '_grist_Tables_column', 2, {widgetOptions: '', type: 'Any'}]
    ]);
  });

  it('respects SCHEMA_EDIT when converting a column', async () => {
    // Initially, schema flag defaults to ON for editor.
    await freshDoc();
    await owner.applyUserActions(docId, [
      ['AddTable', 'Table1', [{id: 'A', type: 'Int'},
                              {id: 'B', type: 'Int'},
                              {id: 'C', type: 'Int'}]],
      ['AddRecord', '_grist_ACLResources', -1, {tableId: 'Table1', colIds: 'C'}],
      // Add at least one access rule. Otherwise the test would succeed
      // trivially, via shortcuts in place when the GranularAccess
      // hasNuancedAccess test returns false. If there are no access
      // rules present, editors can make any edit. Once a granular access
      // rule is present, editors lose some rights that are simply too
      // hard to compute or we haven't gotten around to.
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -1, aclFormula: 'user.Access == OWNER', permissionsText: '-R',
      }],
      ['AddRecord', 'Table1', null, {A: 1234, B: 1234}],
    ]);

    // Make a transformation as editor.
    await editor.applyUserActions(docId, [
      ['AddColumn', 'Table1', 'gristHelper_Converted', {type: 'Text', isFormula: false, visibleCol: 0, formula: ''}],
      ['AddColumn', 'Table1', 'gristHelper_Transform',
       {type: 'Text', isFormula: true, visibleCol: 0, formula: 'rec.gristHelper_Converted'}],
      ["ConvertFromColumn", "Table1", "A", "gristHelper_Converted", "Text", "", 0],
      ["CopyFromColumn", "Table1", "gristHelper_Transform", "A", "{}"],
    ]);

    // Now turn off schema flag for editor.
    await owner.applyUserActions(docId, [
      ['AddRecord', '_grist_ACLResources', -1, {tableId: '*', colIds: '*'}],
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -1, aclFormula: 'user.Access == EDITOR', permissionsText: '-S',
      }],
    ]);

    // Now prepare another transformation.
    const transformation = [
      ['AddColumn', 'Table1', 'gristHelper_Converted2', {type: 'Text', isFormula: false, visibleCol: 0, formula: ''}],
      ['AddColumn', 'Table1', 'gristHelper_Transform2',
       {type: 'Text', isFormula: true, visibleCol: 0, formula: 'rec.gristHelper_Converted2'}],
      ["ConvertFromColumn", "Table1", "B", "gristHelper_Converted2", "Text", "", 0],
      ["CopyFromColumn", "Table1", "gristHelper_Transform", "B", "{}"],
    ];
    // Should fail for editor.
    await assert.isRejected(editor.applyUserActions(docId, transformation),
                            /Blocked by full structure access rules/);
    // Should go through if run as owner.
    await assert.isFulfilled(owner.applyUserActions(docId, transformation));
  });

  async function applyTransformation(colToHide: string) {
    await freshDoc();
    await owner.applyUserActions(docId, [
      ['AddTable', 'Table1', [{id: 'A', type: 'Int'}, {id: 'B', type: 'Int'}]],
      ['AddRecord', '_grist_ACLResources', -1, {tableId: '*', colIds: '*'}],
      ['AddRecord', '_grist_ACLResources', -2, {tableId: 'Table1', colIds: colToHide}],
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -1, aclFormula: 'user.Access != OWNER', permissionsText: '-S',  // drop schema rights
      }],
      ['AddRecord', '_grist_ACLRules', null, {
        // Transform columns are only hidden from non-owners when we have a granular access rules.
        // Here we will hide either column A (which will be transformed) or column B (which is not relevant
        // but will trigger ACL check).
        resource: -2, aclFormula: 'user.Access != OWNER', permissionsText: '-R',
      }],
      ['AddRecord', 'Table1', null, {A: 1234}],
    ]);
    cliEditor.flush();
    cliOwner.flush();

    // Make transformation as owner. This mimics what happens when we apply a transformation using UI (when
    // we change column type from Number to Text).
    await owner.applyUserActions(docId, [
      ['AddColumn', 'Table1', 'gristHelper_Converted', {type: 'Text', isFormula: false, visibleCol: 0, formula: ''}],
      ['AddColumn', 'Table1', 'gristHelper_Transform',
        {type: 'Text', isFormula: true, visibleCol: 0, formula: 'rec.gristHelper_Converted'}],
      // This action is repeated by the UI just before applying (we don't to repeat it here).
      ["ConvertFromColumn", "Table1", "A", "gristHelper_Converted", "Text", "", 0],
      ["CopyFromColumn", "Table1", "gristHelper_Transform", "A", "{}"],
    ]);

    // Make sure we see the actions as owner.
    assert.deepEqual(await cliOwner.readDocUserAction(), [
      ['AddColumn', 'Table1', 'gristHelper_Converted', {isFormula: false, type: 'Text', formula: ''}],
      ['AddRecord', '_grist_Tables_column', 8, {
        isFormula: false,
        type: 'Text',
        formula: '',
        colId: 'gristHelper_Converted',
        widgetOptions: '',
        label: 'gristHelper_Converted',
        parentPos: 8,
        parentId: 1
      }],
      ['AddColumn', 'Table1', 'gristHelper_Transform', {
        isFormula: true,
        type: 'Text',
        formula: 'rec.gristHelper_Converted'
      }],
      ['AddRecord', '_grist_Tables_column', 9, {
        isFormula: true,
        type: 'Text',
        formula: 'rec.gristHelper_Converted',
        colId: 'gristHelper_Transform',
        widgetOptions: '',
        label: 'gristHelper_Transform',
        parentPos: 9,
        parentId: 1
      }],
      ['UpdateRecord', 'Table1', 1, {gristHelper_Converted: '1234'}],
      ['ModifyColumn', 'Table1', 'A', {type: 'Text'}],
      ['UpdateRecord', 'Table1', 1, {A: '1234'}],
      ['UpdateRecord', '_grist_Tables_column', 2, {type: 'Text', widgetOptions: '{}'}],
      ['UpdateRecord', 'Table1', 1, {gristHelper_Transform: '1234'}]
    ]);
  }

  it('persist data when action is rejected', async () => {
    await freshDoc();
    await owner.applyUserActions(docId, [
      ['AddTable', 'Table1', [{id: 'A'}, {id: 'B'}]],
      ['AddRecord', 'Table1', null, {B: 1}],
      ['ModifyColumn', 'Table1', 'B', { isFormula: false, type: 'Text' }],
      ['ModifyColumn', 'Table1', 'A', { formula: 'UUID() + $B', isFormula: true }],
      ['AddRecord', '_grist_ACLResources', -1, {tableId: 'Table1', colIds: '*'}],
      ['AddRecord', '_grist_ACLRules', null, {
        // User can't change column B to 2
        resource: -1,
        aclFormula: 'newRec.B == "2"',
        permissionsText: '-U',
        memo: 'stop',
      }],
    ]);
    // Read A from the engine
    const aMemBefore = await memCell('Table1', 'A', 1);
    // Read A from database.
    const aDbBefore = await dbCell('Table1', 'A', 1);
    assert.equal(aMemBefore, aDbBefore);
    // Trigger rejection.
    await assertDeniedFor(owner.getDocAPI(docId).updateRows('Table1', {id: [1], B: ['2']}), ['stop']);
    // Read A value again.
    const aDbAfter = await dbCell('Table1', 'A', 1);
    // Now read A value from the engine.
    const aMemAfter = await memCell('Table1', 'A', 1);
    assert.equal(aMemAfter, aDbAfter);
    assert.notEqual(aMemAfter, aMemBefore);
  });

  it('persist data when action is rejected with newRec.A != rec.A formula', async () => {
    // Create another example with a different formula.
    await freshDoc();
    await owner.applyUserActions(docId, [
      ['AddTable', 'Table1', [{id: 'A'}, {id: 'B'}]],
      ['AddRecord', 'Table1', null, {B: 1}],
      ['ModifyColumn', 'Table1', 'B', { isFormula: false, type: 'Int' }],
      ['ModifyColumn', 'Table1', 'A', { formula: 'UUID() if $B else UUID()', isFormula: true }],
      ['AddRecord', '_grist_ACLResources', -1, {tableId: 'Table1', colIds: '*'}],
      ['AddRecord', '_grist_ACLRules', null, {
        // We can't trigger A change as it will always have a different value.
        // It looks like we can't reject this action, as it will cause a fatal failure,
        // but this is indirect action, so it will bypass ACL check.
        resource: -1,
        aclFormula: 'newRec.A != rec.A',
        permissionsText: '-U',
        memo: 'stop',
      }],
    ]);

    const aMemBefore = await memCell('Table1', 'A', 1);
    const aDbBefore = await dbCell('Table1', 'A', 1);
    await assertDeniedFor(editor.getDocAPI(docId).updateRows('Table1', {id: [1], B: [2]}), ['stop']);
    const aMemAfter = await memCell('Table1', 'A', 1);
    const aDbAfter = await dbCell('Table1', 'A', 1);
    assert.equal(aMemAfter, aDbAfter);
    assert.equal(aMemBefore, aDbBefore);
    assert.notEqual(aDbBefore, aDbAfter);
    assert.notEqual(aMemBefore, aMemAfter);

    // Make sure we can update formula, as a value change it's not a direct action.
    await assert.isFulfilled(editor.applyUserActions(docId, [
      ['ModifyColumn', 'Table1', 'A', { formula: 'UUID() + "test"'}],
    ]));
  });

  it('persist data when action is rejected with schema action', async () => {
    // Reject schema actions
    await freshDoc();
    await owner.applyUserActions(docId, [
      ['AddTable', 'Table1', [{id: 'A'}]],
      ['AddRecord', 'Table1', null, {}],
      ['ModifyColumn', 'Table1', 'A', { formula: 'UUID()', isFormula: true }],
      ['AddRecord', '_grist_ACLResources', -1, {tableId: '*', colIds: '*'}],
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -1,
        aclFormula: 'user.access != OWNER',
        permissionsText: '-S',
        memo: 'stop',
      }],
    ]);

    const aMemBefore = await memCell('Table1', 'A', 1);
    const aDbBefore = await dbCell('Table1', 'A', 1);
    await assertDeniedFor(editor.applyUserActions(docId, [
      ['RemoveColumn', 'Table1', 'A'],
    ]), ['stop']);
    const aMemAfter = await memCell('Table1', 'A', 1);
    const aDbAfter = await dbCell('Table1', 'A', 1);
    assert.equal(aMemAfter, aDbAfter);
    assert.equal(aMemBefore, aDbBefore);
    assert.notEqual(aDbBefore, aDbAfter);
    assert.notEqual(aMemBefore, aMemAfter);
  });

  it('fails when action cannot be rejected', async () => {
    // Reject schema actions
    await freshDoc();
    await owner.applyUserActions(docId, [
      ['AddTable', 'Table1', [{id: 'A'}, {id: 'B'}]],
      ['AddRecord', 'Table1', null, {B: 1}],
      ['ModifyColumn', 'Table1', 'B', { isFormula: false, type: 'Int' }],
      ['ModifyColumn', 'Table1', 'A', { formula: 'UUID() if $B else UUID()', isFormula: true }],
      ['AddRecord', '_grist_ACLResources', -1, {tableId: 'Table1', colIds: '*'}],
      ['AddRecord', '_grist_ACLRules', null, {
        // We can't trigger A change as it will always have a different value.
        // We can't also reject this action, as it will cause a fatal failure (with a direct action)
        resource: -1,
        aclFormula: 'newRec.A != rec.A',
        permissionsText: '-U',
        memo: 'doom',
      }],
    ]);
    const engine = await docManager.getActiveDoc(docId)!;
    // Now simulate a situation that extra actions generated by data engine are
    // direct, with this, we should receive a fatal error.
    const sharing = (engine as any)._sharing;
    const stub: any = sinon.stub(sharing, '_createExtraBundle').callsFake((bundle: any, actions: any) => {
      const result: SandboxActionBundle = stub.wrappedMethod(bundle, actions);
      // Simulate direct actions.
      result.direct = result.direct.map(([index]) => [index, true]);
      return result;
    });
    try {
      cliEditor.flush();
      cliOwner.flush();
      await assertFlux(editor.getDocAPI(docId).updateRows('Table1', {id: [1], B: [2]}));
    } finally {
      stub.restore();
    }
    assert.equal((await cliEditor.readMessage()).type, 'docShutdown');
    assert.equal((await cliOwner.readMessage()).type, 'docShutdown');
  });

  async function memCell(tableId: string, colId: string, rowId: number) {
    const engine = await docManager.getActiveDoc(docId)!;
    const systemSession = makeExceptionalDocSession('system');
    const {tableData} = await engine.fetchTable(systemSession, tableId, true);
    return tableData[3][colId][tableData[2].indexOf(rowId)];
  }

  async function dbCell(tableId: string, colId: string, rowId: number) {
    const engine = await docManager.getActiveDoc(docId)!;
    const table = await engine.docStorage.fetchActionData(tableId, [rowId], [colId]);
    return table[3][colId][0];
  }

  it('respects owner-private tables', async function() {
    await freshDoc();

    // Add spies to check whether unexpected calculations are made, to prevent
    // regression of optimizations.
    const granularAccess = await getGranularAccess();
    const metaSteps = sinon.spy(granularAccess, '_getMetaSteps' as any);
    const rowSteps = sinon.spy(granularAccess, '_getSteps' as any);
    assert.equal(metaSteps.called, false);
    assert.equal(rowSteps.called, false);

    // Make a Private table and mark it as owner-only (using temporary representation).
    // Make a Public table without any particular access control.
    await owner.applyUserActions(docId, [
      ['AddTable', 'Private', [{id: 'A'}]],
      ['AddTable', 'PartialPrivate', [{id: 'A'}]],
      ['AddRecord', 'PartialPrivate', null, { A: 0 }],
      ['AddRecord', 'PartialPrivate', null, { A: 1 }],
      ['AddRecord', '_grist_ACLResources', -1, {tableId: 'Private', colIds: '*'}],
      ['AddRecord', '_grist_ACLResources', -2, {tableId: '*', colIds: '*'}],
      ['AddRecord', '_grist_ACLResources', -3, {tableId: 'PartialPrivate', colIds: '*'}],
      ['AddRecord', '_grist_ACLRules', null, {
        // Negative IDs refer to rowIds used in the same action bundle.
        resource: -1,
        aclFormula: 'user.Access == "owners"',
        permissionsText: 'all',
        memo: 'owner check',
      }],
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -1, aclFormula: '', permissionsText: 'none',
      }],
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -2, aclFormula: 'user.Access != "owners"', permissionsText: '-S',  // drop schema rights
      }],
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -3, aclFormula: 'user.Access != "owners" and rec.A > 0', permissionsText: 'none',
      }],
      ['AddTable', 'Public', [{id: 'A'}]],
    ]);

    // Owner can access both Private and Public tables.
    await assert.isFulfilled(owner.getDocAPI(docId).getRows('Private'));
    await assert.isFulfilled(owner.getDocAPI(docId).getRows('Public'));

    // Editor can access the Public table but not the Private table.
    await assert.isRejected(editor.getDocAPI(docId).getRows('Private'));
    await assert.isFulfilled(editor.getDocAPI(docId).getRows('Public'));

    await assertDeniedFor(editor.getDocAPI(docId).getRows('Private'), ['owner check']);

    // Metadata to editor should be filtered.  Private metadata gets blanked out
    // rather than deleted, to keep ids consistent.
    const tables = await editor.getDocAPI(docId).getRows('_grist_Tables');
    assert.deepEqual(tables['tableId'], ['Table1', '', 'PartialPrivate', 'Public']);

    // Owner can download, editor can not.
    await assert.isFulfilled((await owner.getWorkerAPI(docId)).downloadDoc(docId));
    await assert.isRejected((await editor.getWorkerAPI(docId)).downloadDoc(docId));

    // Owner can copy, editor can not.
    await assert.isFulfilled((await owner.getWorkerAPI(docId)).copyDoc(docId));
    await assert.isRejected((await editor.getWorkerAPI(docId)).copyDoc(docId));

    // Owner can use AddColumn, editor can not (even for public table).
    await assert.isFulfilled(owner.applyUserActions(docId, [
      ['AddColumn', 'Public', 'B', {}],
      ['AddColumn', 'Public', 'C', {}],
    ]));
    await assert.isRejected(editor.applyUserActions(docId, [
      ['AddColumn', 'Public', 'editorB', {}]
    ]));

    // Owner can use RemoveColumn, editor can not (even for public table).
    await assert.isFulfilled(owner.applyUserActions(docId, [
      ['RemoveColumn', 'Public', 'B']
    ]));
    await assert.isRejected(editor.applyUserActions(docId, [
      ['RemoveColumn', 'Public', 'C']
    ]));

    // Check that changing a private table's data results in a broadcast to owner but not editor.
    cliEditor.flush();
    cliOwner.flush();
    await owner.getDocAPI(docId).addRows('Private', {A: [99, 100]});
    assert.lengthOf(await cliOwner.readDocUserAction(), 1);
    assert.equal(cliEditor.count(), 0);

    // Check that changing a private table's columns results in a full broadcast to owner, but
    // a filtered broadcast to editor.
    await assert.isFulfilled(owner.applyUserActions(docId, [
      ['AddVisibleColumn', 'Private', 'X', {}],
    ]));
    const ownerUpdate = await cliOwner.readDocUserAction();
    const editorUpdate = await cliEditor.readDocUserAction();
    assert.deepEqual(ownerUpdate.map(a => a[0]), ['AddColumn', 'AddRecord', 'AddRecord', 'AddRecord', 'AddRecord']);
    assert.deepEqual(editorUpdate.map(a => a[0]), ['AddRecord', 'AddRecord', 'AddRecord', 'AddRecord']);
    assert.equal((ownerUpdate[1] as AddRecord)[3].label, 'X');
    assert.equal((editorUpdate[0] as AddRecord)[3].label, '');

    // Owner can modify metadata, editor can not.
    await assert.isFulfilled(owner.applyUserActions(docId, [
      ["UpdateRecord", "_grist_Tables_column", 1, {formula: "X"}]
    ]));
    await assert.isRejected(editor.applyUserActions(docId, [
      ["UpdateRecord", "_grist_Tables_column", 1, {formula: "Y"}]
    ]));
    await assert.isFulfilled(owner.applyUserActions(docId, [
      ["AddRecord", "_grist_Tables_column", null, {formula: ""}]
    ]));
    await assert.isRejected(editor.applyUserActions(docId, [
      ["AddRecord", "_grist_Tables_column", null, {formula: ""}]
    ]));

    // Check we have never computed row steps yet.
    assert.equal(metaSteps.called, true);
    assert.equal(rowSteps.called, false);

    // Now do something to tickle row step calculation, and make sure it happens.
    await owner.getDocAPI(docId).addRows('PartialPrivate', {A: [99, 100]});
    assert.equal(rowSteps.called, true);

    // Check editor cannot see private table schema via fetchPythonCode.
    assert.match((await cliEditor.send('fetchPythonCode', 0)).error!, /Cannot view code/);
    assert.equal((await cliOwner.send('fetchPythonCode', 0)).error, undefined);
  });

  it('reports memos sensibly', async function() {
    await freshDoc();
    await owner.applyUserActions(docId, [
      ['AddTable', 'Table1', [{id: 'A'}]],
      ['AddRecord', 'Table1', null, {A: 'test1'}],
      ['AddRecord', 'Table1', null, {A: 'test2'}],
      ['AddTable', 'Table2', [{id: 'A'}]],
      ['AddRecord', '_grist_ACLResources', -1, {tableId: '*', colIds: '*'}],
      ['AddRecord', '_grist_ACLResources', -2, {tableId: 'Table2', colIds: '*'}],
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -1, aclFormula: 'rec.A == "test1"', permissionsText: 'none',
      }],
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -1,
        aclFormula: 'rec.A == "test2"',
        permissionsText: '-D',
        memo: 'rule_d1',
      }],
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -1,
        aclFormula: 'rec.A == "test2"',
        permissionsText: '-D',
        memo: 'rule_d2',
      }],
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -1,
        aclFormula: 'rec.A == "test1"',
        permissionsText: '+U',
        memo: 'rule_u',
      }],
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -1,   // Used to have -2, but table-specific rules cannot specify schemaEdit
                        // permission today; it now gets ignored if they do.
        aclFormula: 'True',
        permissionsText: '-S',
        memo: 'rule_s',
      }],
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -1, aclFormula: '', permissionsText: '-U',
      }],
    ]);
    await assertDeniedFor(owner.getDocAPI(docId).removeRows('Table1', [1]), []);
    await assertDeniedFor(owner.getDocAPI(docId).removeRows('Table1', [2]), ['rule_d1', 'rule_d2']);
    await assertDeniedFor(owner.getDocAPI(docId).updateRows('Table1', {id: [2], A: ['x']}),
                          ['rule_u']);
    await assertDeniedFor(owner.applyUserActions(docId, [
      ['AddVisibleColumn', 'Table2', 'B', {}],
    ]), ['rule_s']);
    await assertDeniedFor(owner.applyUserActions(docId, [
      ['ModifyColumn', 'Table2', 'A', {formula: 'a formula'}],
    ]), ['rule_s']);
  });

  it('respects table wildcard', async function() {
    await freshDoc();

    // Make a Private table, using wildcard.
    await owner.applyUserActions(docId, [
      ['AddTable', 'Private', [{id: 'A'}]],
      ['AddRecord', '_grist_ACLResources', -1, {tableId: '*', colIds: '*'}],
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -1, aclFormula: 'user.Access != "owners"', permissionsText: 'none',
      }],

      ['AddTable', 'Private', [{id: 'A'}]],
    ]);

    // Owner can access Private table.
    await assert.isFulfilled(owner.getDocAPI(docId).getRows('Private'));

    // Editor cannot access Private table.
    await assert.isRejected(editor.getDocAPI(docId).getRows('Private'));
  });

  it('checks for special actions after schema actions', async function() {
    await freshDoc();

    // Make a table with an owner-private column, and with only the owner
    // allowed to make schema changes.
    await owner.applyUserActions(docId, [
      ['AddTable', 'Data1', [{id: 'A'}, {id: 'B', widgetOptions: "{}"}]],
      ['AddRecord', 'Data1', null, {A: 'a1', B: 'b1'}],
      ['AddRecord', 'Data1', null, {A: 'a2', B: 'b2'}],
      ['AddRecord', '_grist_ACLResources', -1, {tableId: 'Data1', colIds: 'A'}],
      ['AddRecord', '_grist_ACLResources', -2, {tableId: '*', colIds: '*'}],
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -1, aclFormula: 'user.Access not in [OWNER]', permissionsText: '-RU',
      }],
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -2, aclFormula: 'user.Access not in [OWNER]', permissionsText: '-S',  // drop schema rights
      }],
    ]);

    assert.deepEqual(await owner.getDocAPI(docId).getRows('Data1'), {
      id: [ 1, 2 ],
      manualSort: [ 1, 2 ],
      A: [ 'a1', 'a2' ],
      B: [ 'b1', 'b2' ],
    });

    assert.deepEqual(await editor.getDocAPI(docId).getRows('Data1'), {
      id: [ 1, 2 ],
      manualSort: [ 1, 2 ],
      B: [ 'b1', 'b2' ],
    });

    await assert.isRejected(editor.applyUserActions(docId, [
      ['CopyFromColumn', 'Data1', 'A', 'B', {}],
    ]), /Blocked by full structure access rules/);

    await assert.isRejected(editor.applyUserActions(docId, [
      ['RenameColumn', 'Data1', 'B', 'B'],
      ['CopyFromColumn', 'Data1', 'A', 'B', {}],
    ]), /Blocked by full structure access rules/);

    assert.deepEqual(await editor.getDocAPI(docId).getRows('Data1'), {
      id: [ 1, 2 ],
      manualSort: [ 1, 2 ],
      B: [ 'b1', 'b2' ],
    });

    await assert.isFulfilled(owner.applyUserActions(docId, [
      ['RenameColumn', 'Data1', 'B', 'B'],
      ['CopyFromColumn', 'Data1', 'A', 'B', {}],
    ]));

    assert.deepEqual(await editor.getDocAPI(docId).getRows('Data1'), {
      id: [ 1, 2 ],
      manualSort: [ 1, 2 ],
      B: [ 'a1', 'a2' ],
    });
  });

  it('respects owner-only structure', async function() {
    await freshDoc();

    // Make some tables, and lock structure.
    await owner.applyUserActions(docId, [
      ['AddTable', 'Public1', [{id: 'A', type: 'Text'}]],
      ['AddRecord', '_grist_ACLResources', -1, {tableId: '*', colIds: '*'}],
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -1, aclFormula: 'user.Access != "owners"', permissionsText: '-S',
      }],
      ['AddTable', 'Public2', [{id: 'A', type: 'Text'}]],
    ]);

    // Owner can access all tables.
    await assert.isFulfilled(owner.getDocAPI(docId).getRows('Public1'));
    await assert.isFulfilled(owner.getDocAPI(docId).getRows('Public2'));

    // Editor can access all tables.
    await assert.isFulfilled(editor.getDocAPI(docId).getRows('Public1'));
    await assert.isFulfilled(editor.getDocAPI(docId).getRows('Public2'));

    // Owner and editor can download.
    await assert.isFulfilled((await owner.getWorkerAPI(docId)).downloadDoc(docId));
    await assert.isFulfilled((await editor.getWorkerAPI(docId)).downloadDoc(docId));

    // Owner and editor can download.
    await assert.isFulfilled((await owner.getWorkerAPI(docId)).copyDoc(docId));
    await assert.isFulfilled((await editor.getWorkerAPI(docId)).copyDoc(docId));

    // Owner can use AddColumn, editor can not.
    await assert.isFulfilled(owner.applyUserActions(docId, [
      ['AddVisibleColumn', 'Public1', 'B', {}],
      ['AddColumn', 'Public1', 'C', {}],
    ]));
    await assert.isRejected(editor.applyUserActions(docId, [
      ['AddVisibleColumn', 'Public1', 'editorB', {}]
    ]));
    await assert.isRejected(editor.applyUserActions(docId, [
      ['AddColumn', 'Public1', 'editorB', {}]
    ]));

    // Owner can use RemoveColumn, editor can not.
    await assert.isFulfilled(owner.applyUserActions(docId, [
      ['RemoveColumn', 'Public1', 'B']
    ]));
    await assert.isRejected(editor.applyUserActions(docId, [
      ['RemoveColumn', 'Public1', 'C']
    ]));

    // Owner can add an empty table, editor can not.
    await assert.isFulfilled(owner.applyUserActions(docId, [
      ["AddEmptyTable", null]
    ]));
    await assert.isRejected(editor.applyUserActions(docId, [
      ["AddEmptyTable", null]
    ]), /Blocked by table structure access rules/);

    // Owner can duplicate a table, editor can not.
    await assert.isFulfilled(owner.applyUserActions(docId, [
      ['DuplicateTable', 'Public1', 'Public1Copy', false]
    ]));
    await assert.isRejected(editor.applyUserActions(docId, [
      ['DuplicateTable', 'Public1', 'Public1Copy', false]
    ]), /Blocked by table structure access rules/);

    // Owner can modify metadata, editor can not.
    await assert.isFulfilled(owner.applyUserActions(docId, [
      ["UpdateRecord", "_grist_Tables_column", 1, {formula: ""}]
    ]));
    await assert.isRejected(editor.applyUserActions(docId, [
      ["UpdateRecord", "_grist_Tables_column", 1, {formula: "X"}]
      // Need to change formula, or update will be ignored and thus succeed
    ]));
    await assert.isFulfilled(owner.applyUserActions(docId, [
      ["AddRecord", "_grist_Tables_column", null, {formula: ""}]
    ]));
    await assert.isRejected(editor.applyUserActions(docId, [
      ["AddRecord", "_grist_Tables_column", null, {formula: ""}]
    ]));
    await assert.isFulfilled(owner.applyUserActions(docId, [
      ["UpdateRecord", "_grist_Pages", 1, {indentation: 2}]
    ]));
    await assert.isRejected(editor.applyUserActions(docId, [
      ["UpdateRecord", "_grist_Pages", 1, {indentation: 3}]
    ]));
  });

  it('owner can edit rules without structure permission', async function() {
    await freshDoc();

    // Make some tables, and lock structure completely.
    await owner.applyUserActions(docId, [
      ['AddTable', 'Public1', [{id: 'A'}]],
      ['AddRecord', '_grist_ACLResources', -1, {tableId: '*', colIds: '*'}],
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -1, aclFormula: '', permissionsText: '-S',
      }],
      ['AddTable', 'Public2', [{id: 'A'}]],
    ]);

    // Can still read.
    await assert.isFulfilled(owner.getDocAPI(docId).getRows('Public1'));

    // Can edit data.
    await assert.isFulfilled(owner.getDocAPI(docId).addRows('Public1', {A: [67]}));

    // Cannot rename column.
    await assert.isRejected(owner.applyUserActions(docId, [
      ['RenameColumn', 'Public1', 'A', 'Z'],
    ]), /Blocked by table structure access rules/);

    // Can still change rules.
    await owner.applyUserActions(docId, [
      ['UpdateRecord', '_grist_ACLRules', 2, {
        aclFormula: 'True', permissionsText: '+S',
      }],
    ]);

    // Can change columns again.
    await assert.isFulfilled(owner.applyUserActions(docId, [
      ['RenameColumn', 'Public1', 'A', 'Z'],
    ]));
  });

  it("supports AddEmptyTable", async function() {
    await freshDoc();
    // Make some tables, and lock structure.
    await owner.applyUserActions(docId, [
      ['AddTable', 'Public1', [{id: 'A'}]],
      ['AddRecord', '_grist_ACLResources', -1, {tableId: '*', colIds: '*'}],
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -1, aclFormula: 'user.Access != "owners"', permissionsText: '-S',
      }],
      ['AddTable', 'Public2', [{id: 'A'}]],
    ]);

    await assert.isFulfilled(owner.applyUserActions(docId, [
      ["AddEmptyTable", null]
    ]));
    await assert.isRejected(editor.applyUserActions(docId, [
      ["AddEmptyTable", null]
    ]));
  });

  it("blocks formulas early", async function() {
    await freshDoc();
    // Make some tables, and lock structure.
    await owner.applyUserActions(docId, [
      ['AddTable', 'Table1', [{id: 'A'}]],
      ['AddRecord', 'Table1', null, {A: [100]}],
      ['AddRecord', '_grist_ACLResources', -1, {tableId: '*', colIds: '*'}],
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -1, aclFormula: 'user.Access != "owners"', permissionsText: '-S',
      }],
    ]);

    // Try a modification that would have a detectable side-effect even if reverted.
    await assert.isRejected(editor.applyUserActions(docId, [
      ["ModifyColumn", "Table1", "A", {"isFormula": true, formula: "datetime.MAXYEAR=1234",
                                       type: 'Int'}]
    ]), /Blocked by full structure access rules/);

    await assert.isRejected(editor.applyUserActions(docId, [
      ["UpdateRecord", "_grist_Tables_column", 1, {formula: "datetime.MAXYEAR=1234"}]
    ]), /Blocked by full structure access rules/);

    await assert.isRejected(editor.applyUserActions(docId, [
      ["AddRecord", "_grist_Tables_column", null, {formula: "datetime.MAXYEAR=1234"}]
    ]), /Blocked by full structure access rules/);

    await assert.isRejected(editor.applyUserActions(docId, [
      ["AddRecord", "_grist_Validations", null, {formula: "datetime.MAXYEAR=1234"}]
    ]), /Blocked by full structure access rules/);

    await assert.isRejected(editor.applyUserActions(docId, [
      ["SetDisplayFormula", "Table1", null, 1, "datetime.MAXYEAR=1234"]
    ]), /Blocked by full structure access rules/);

    // Make sure that the poison formula was never evaluated.
    await owner.applyUserActions(docId, [
      ["ModifyColumn", "Table1", "A", {"isFormula": true, formula: "datetime.MAXYEAR",
                                       type: 'Int'}]
    ]);
    assert.deepEqual((await owner.getDocAPI(docId).getRows('Table1')).A, [9999]);
  });

  it("allows AddOrUpdateRecord only with full read access", async function() {
    await freshDoc();
    // Make some tables, and lock structure.
    await owner.applyUserActions(docId, [
      ['AddTable', 'Data1', [{id: 'A', type: 'Numeric'}]],
      ['AddRecord', 'Data1', null, {A: 100}],
      ['AddTable', 'Data2', [{id: 'A', type: 'Numeric'}]],
      ['AddRecord', 'Data2', null, {A: 100}],
      ['AddTable', 'Data3', [{id: 'A', type: 'Numeric'}]],
      ['AddRecord', 'Data3', null, {A: 100}],
      ['AddTable', 'Data4', [{id: 'A', type: 'Numeric'}]],
      ['AddRecord', 'Data4', null, {A: 100}],
      ['AddTable', 'Data5', [{id: 'A', type: 'Numeric'}]],
      ['AddRecord', 'Data5', null, {A: 100}],
      ['AddRecord', '_grist_ACLResources', -1, {tableId: 'Data2', colIds: '*'}],
      ['AddRecord', '_grist_ACLResources', -2, {tableId: 'Data3', colIds: '*'}],
      ['AddRecord', '_grist_ACLResources', -3, {tableId: 'Data4', colIds: '*'}],
      ['AddRecord', '_grist_ACLResources', -4, {tableId: 'Data5', colIds: '*'}],
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -1, aclFormula: 'user.Access != "owners"', permissionsText: '-R',
      }],
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -2, aclFormula: 'rec.A == 999', permissionsText: '-R',
      }],
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -3, aclFormula: 'user.Access != "owners"', permissionsText: '-U',
      }],
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -4, aclFormula: 'user.Access != "owners"', permissionsText: '-C',
      }],
    ]);

    // Can AddOrUpdateRecord on a table with full read access.
    await assert.isFulfilled(editor.applyUserActions(docId, [
      ["AddOrUpdateRecord", "Data1", {"A": 100}, {"A": 200}, {}]
    ]));
    assert.deepEqual(await editor.getDocAPI(docId).getRows('Data1'), {
      id: [ 1 ],
      manualSort: [ 1 ],
      A: [ 200 ],
    });

    // Cannot AddOrUpdateRecord on a table without read access.
    await assert.isRejected(editor.applyUserActions(docId, [
      ["AddOrUpdateRecord", "Data2", {"A": 100}, {"A": 200}, {}]
    ]), /Blocked by table read access rules/);

    // Cannot AddOrUpdateRecord on a table with partial read access.
    await assert.isRejected(editor.applyUserActions(docId, [
      ["AddOrUpdateRecord", "Data3", {"A": 100}, {"A": 200}, {}]
    ]), /Blocked by table read access rules/);

    // Currently cannot combine AddOrUpdateRecord with RenameTable.
    await assert.isRejected(editor.applyUserActions(docId, [
      ["RenameTable", "Data1", "DataX"],
      ["RenameTable", "Data2", "Data1"],
      ["AddOrUpdateRecord", "Data1", {"A": 200}, {"A": 300}, {}]
    ]), /Can only combine AddOrUpdateRecord and BulkAddOrUpdateRecord with simple data changes/);

    // Currently cannot use AddOrUpdateRecord for metadata changes.
    await assert.isRejected(editor.applyUserActions(docId, [
      ["AddOrUpdateRecord", "Data1", {"A": 200}, {"A": 300}, {}],
      ["AddOrUpdateRecord", "_grist_Tables", {tableId: "Data1"}, {tableId: "DataX"}, {}],
    ]), /AddOrUpdateRecord cannot yet be used on metadata tables/);

    // Currently cannot combine AddOrUpdateRecord with metadata changes.
    await assert.isRejected(editor.applyUserActions(docId, [
      ["AddOrUpdateRecord", "Data1", {"A": 200}, {"A": 300}, {}],
      ["UpdateRecord", "_grist_Tables", 1, {tableId: "DataX"}],
    ]), /Can only combine AddOrUpdateRecord and BulkAddOrUpdateRecord with simple data changes/);

    // Can combine some simple data changes.
    await assert.isFulfilled(editor.applyUserActions(docId, [
      ["AddOrUpdateRecord", "Data1", {"A": 200}, {"A": 300}, {}],
      ["AddOrUpdateRecord", "Data1", {"A": 500}, {"A": 600}, {}],
      ["AddOrUpdateRecord", "Data1", {"A": 300}, {"A": 400}, {}],
    ]));
    assert.deepEqual(await editor.getDocAPI(docId).getRows('Data1'), {
      id: [ 1, 2 ],
      manualSort: [ 1, 2 ],
      A: [ 400, 600 ],
    });

    // Need both update + create rights
    await assert.isRejected(editor.applyUserActions(docId, [
      ["AddOrUpdateRecord", "Data4", {"A": 100}, {"A": 200}, {}],
    ]), /Blocked by table update access rules/);
    await assert.isRejected(editor.applyUserActions(docId, [
      ["AddOrUpdateRecord", "Data4", {"A": 300}, {"A": 200}, {}],
    ]), /Blocked by table update access rules/);
    await assert.isRejected(editor.applyUserActions(docId, [
      ["AddOrUpdateRecord", "Data5", {"A": 100}, {"A": 200}, {}],
    ]), /Blocked by table create access rules/);
    await assert.isRejected(editor.applyUserActions(docId, [
      ["AddOrUpdateRecord", "Data5", {"A": 300}, {"A": 200}, {}],
    ]), /Blocked by table create access rules/);
  });

  it("allows DuplicateTable only with full read access", async function() {
    await freshDoc();
    await owner.applyUserActions(docId, [
      ['AddTable', 'Data1', [{id: 'A', type: 'Numeric'}]],
      ['AddRecord', 'Data1', null, {A: 100}],
      ['AddTable', 'Data2', [{id: 'A', type: 'Numeric'}]],
      ['AddRecord', 'Data2', null, {A: 100}],
      ['AddTable', 'Data3', [{id: 'A', type: 'Numeric'}]],
      ['AddRecord', 'Data3', null, {A: 100}],
      ['AddTable', 'Data4', [{id: 'A', type: 'Numeric'}]],
      ['AddRecord', 'Data4', null, {A: 100}],
      ['AddTable', 'Data5', [{id: 'A', type: 'Numeric'}]],
      ['AddRecord', 'Data5', null, {A: 100}],
      ['AddRecord', '_grist_ACLResources', -1, {tableId: 'Data2', colIds: '*'}],
      ['AddRecord', '_grist_ACLResources', -2, {tableId: 'Data3', colIds: '*'}],
      ['AddRecord', '_grist_ACLResources', -3, {tableId: 'Data4', colIds: '*'}],
      ['AddRecord', '_grist_ACLResources', -4, {tableId: 'Data5', colIds: '*'}],
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -1, aclFormula: 'user.Access != "owners"', permissionsText: '-R',
      }],
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -2, aclFormula: 'rec.A == 999', permissionsText: '-R',
      }],
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -4, aclFormula: 'user.Access != "owners"', permissionsText: '-C',
      }],
    ]);

    // Can perform DuplicateTable on a table with full read access.
    await assert.isFulfilled(editor.applyUserActions(docId, [
      ["DuplicateTable", "Data1", "Data1Copy", true]
    ]));
    assert.deepEqual(await editor.getDocAPI(docId).getRows('Data1Copy'), {
      id: [ 1 ],
      manualSort: [ 1 ],
      A: [ 100 ],
    });

    // Cannot perform DuplicateTable on a table without read access.
    for (const includeData of [false, true]) {
      await assert.isRejected(editor.applyUserActions(docId, [
        ["DuplicateTable", "Data2", "Data2Copy", includeData]
      ]), /Blocked by table read access rules/);
    }

    // Cannot perform DuplicateTable on a table with partial read access.
    for (const includeData of [false, true]) {
      await assert.isRejected(editor.applyUserActions(docId, [
        ["DuplicateTable", "Data3", "Data3Copy", includeData]
      ]), /Blocked by table read access rules/);
    }

    // Cannot perform DuplicateTable (with data) on a table without create access.
    await assert.isRejected(editor.applyUserActions(docId, [
      ["DuplicateTable", "Data5", "Data5Copy", true]
    ]), /Blocked by table create access rules/);

    // Check that denied schemaEdit prevents duplication. We can duplicate Data4 table until we deny schemaEdit.
    await assert.isFulfilled(editor.applyUserActions(docId, [
      ["DuplicateTable", "Data1", "Data4Copy0", true]
    ]));
    await owner.applyUserActions(docId, [
      ['AddRecord', '_grist_ACLResources', -1, {tableId: '*', colIds: '*'}],
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -1, aclFormula: 'user.Access != "owners"', permissionsText: '-S',
      }],
    ]);
    // Cannot perform DuplicateTable on a table without schema edit access.
    for (const includeData of [false, true]) {
      await assert.isRejected(editor.applyUserActions(docId, [
        ["DuplicateTable", "Data4", "Data4Copy", includeData]
      ]), /Blocked by table structure access rules/);
    }

    // Owner can still perform DuplicateTable, even with partial read access or
    // without schema edit access.
    for (const includeData of [false, true]) {
      await assert.isFulfilled(owner.applyUserActions(docId, [
        ["DuplicateTable", "Data3", "Data3Copy", includeData]
      ]));
      await assert.isFulfilled(owner.applyUserActions(docId, [
        ["DuplicateTable", "Data4", "Data4Copy", includeData]
      ]));
    }

    // Cannot combine DuplicateTable with other actions.
    for (const includeData of [false, true]) {
      await assert.isRejected(owner.applyUserActions(docId, [
        ["UpdateRecord", "_grist_Tables", 4, {tableId: "Data3New"}],
        ["DuplicateTable", "Data3New", "Data3NewCopy", includeData],
      ]), /DuplicateTable currently cannot be combined with other actions/);
      await assert.isRejected(owner.applyUserActions(docId, [
        ["AddOrUpdateRecord", "Data3", {"A": 100}, {"A": 200}, {}],
        ["DuplicateTable", "Data3", "Data3Copy", includeData],
      ]), /DuplicateTable currently cannot be combined with other actions/);
      await assert.isRejected(owner.applyUserActions(docId, [
        ["DuplicateTable", "Data3", "Data3Copy", includeData],
        ["AddRecord", "Data3Copy", null, {"A": 100}],
      ]), /DuplicateTable currently cannot be combined with other actions/);
    }

    // Cannot duplicate metadata tables.
    for (const includeData of [false, true]) {
      await assert.isRejected(owner.applyUserActions(docId, [
        ["DuplicateTable", "_grist_Tables", "_grist_Tables", includeData],
      ]), /DuplicateTable cannot be used on metadata tables/);
    }
  });

  it('allows a table that only owner can add/remove rows from', async function() {
    await freshDoc();

    await owner.applyUserActions(docId, [
      ['AddTable', 'Data', [{id: 'A'}]],
      ['AddRecord', 'Data', null, {A: 42}],
      ['AddRecord', '_grist_ACLResources', -1, {tableId: '*', colIds: '*'}],
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -1, aclFormula: 'user.Access != "owners"', permissionsText: '-CD',
      }]
    ]);

    // Owner and editor can read table.
    assert.lengthOf((await owner.getDocAPI(docId).getRows('Data')).id, 1);
    assert.lengthOf((await editor.getDocAPI(docId).getRows('Data')).id, 1);

    // Owner and editor can modify rows.
    await assert.isFulfilled(owner.getDocAPI(docId).updateRows('Data', {id: [1], A: [67]}));
    await assert.isFulfilled(editor.getDocAPI(docId).updateRows('Data', {id: [1], A: [68]}));

    // Editor cannot add or remove rows.
    await assert.isRejected(editor.getDocAPI(docId).addRows('Data', {A: [999]}));
    await assert.isRejected(editor.getDocAPI(docId).removeRows('Data', [1]));

    // Owner can add and remove rows.
    await assert.isFulfilled(owner.getDocAPI(docId).addRows('Data', {A: [999]}));
    await assert.isFulfilled(owner.getDocAPI(docId).removeRows('Data', [1]));
  });

  it('allows an editor to edit conditional formatting with a published form', async function () {
    await freshDoc();

    // Create a doc with a published form
    await owner.applyUserActions(docId, [
      // Add a table
      ['AddTable', 'Data', [{ id: 'A' }]],
      ['AddRecord', 'Data', null, { A: 42 }],

      // Add a published form
      ['AddRecord', '_grist_Shares', null, {
        linkId: 'x',
        options: '{"publish": true}'
      }],
      ['UpdateRecord', '_grist_Views_section', 1,
        { shareOptions: '{"publish": true, "form": true}' }],
      ['UpdateRecord', '_grist_Pages', 1, { shareRef: 1 }],
    ]);

    await assert.isFulfilled(editor.applyUserActions(docId, [
      // Add a conditional formatting rule
      ['AddEmptyRule', 'Data', 0, 1],
      ['UpdateRecord', '_grist_Tables_column', 1, { 'formula': '$A == 42' }],
    ]));

    await assert.isFulfilled(editor.applyUserActions(docId, [
      // Delete the rule
      ['RemoveColumn', 'Data', "gristHelper_ConditionalRule"],
      ['RemoveRecord', '_grist_Tables_column', 1],
    ]));

    await removeShares(docId, owner);
  });

  it('rejects disabled users over websockets', async function() {
    await freshDoc();

    await owner.applyUserActions(docId, [
      ['AddTable', 'Data', [{id: 'A'}]],
      ['AddRecord', 'Data', null, {A: 42}],
    ]);

    // Owner and editor can read table.
    assert.equal((await cliOwner.send("fetchTable", 0, 'Data')).data.tableData[3].A, 42);
    assert.equal((await cliEditor.send("fetchTable", 0, 'Data')).data.tableData[3].A, 42);

    // ham (as in dramatic actor) is the admin
    const admin = await home.createHomeApi('ham', 'docs', true);

    // Admin bans the editor
    const editorProfile = await editor.getUserProfile();
    await admin.disableUser(editorProfile.id);
    home.dbManager.flushDocAuthCache();

    function assertResponseDenied(resp: any){
      assert.equal(resp.errorCode, 'AUTH_NO_VIEW');
      assert.equal(resp.error, 'No view access');
    }

    // Editor should not be able to read or write anymore
    assertResponseDenied(await cliEditor.send(
      'fetchTable', 0, 'Data'
    ));
    assertResponseDenied(await cliEditor.send(
      'applyUserActions', 0, [['UpdateRecord', 'Data', 1, {A: 68}]]
    ));
    assertResponseDenied(await cliEditor.send(
      'applyUserActions', 0, [['AddRecord', 'Data', null, {A: 999}]]
    ));
    assertResponseDenied(await cliEditor.send(
      'applyUserActions', 0, [['RemoveRecord', 'Data', 1]]
    ));

    // Not even openDoc should work
    assertResponseDenied(await cliEditor.send('openDoc', docId));

    // Admin restores the editor
    await admin.enableUser(editorProfile.id);
    home.dbManager.flushDocAuthCache();

    function assertResponsePasses(resp: any) {
      assert.isDefined(resp.data);
      assert.isUndefined(resp.error);
      assert.isUndefined(resp.errorCode);
    }

    // Editor can now do everything again.
    assertResponsePasses(await cliEditor.send(
      'fetchTable', 0, 'Data'));
    assertResponsePasses(await cliEditor.send(
      'applyUserActions', 0, [['UpdateRecord', 'Data', 1, {A: 68}]]
    ));
    assertResponsePasses(await cliEditor.send(
      'applyUserActions', 0, [['AddRecord', 'Data', null, {A: 999}]]
    ));
    assertResponsePasses(await cliEditor.send(
      'applyUserActions', 0, [['RemoveRecord', 'Data', 1]]
    ));

    // Including calling openDoc
    assertResponsePasses(await cliEditor.send('openDoc', docId));
  });

  it('respects row-level access control', async function() {
    await freshDoc();
    // Make a table, and limit non-owner access to some rows.
    await owner.applyUserActions(docId, [
      ['AddTable', 'Data1', [{id: 'A'},
                            {id: 'B'},
                            {id: 'Public', isFormula: true, formula: '$B == "clear"'}]],
      ['AddRecord', 'Data1', null, {A: 1, B: 'clear'}],
      ['AddRecord', 'Data1', null, {A: 2, B: 'notclear'}],
      ['AddRecord', 'Data1', null, {A: 3, B: 'clear'}],

      ['AddRecord', '_grist_ACLResources', -1, {tableId: 'Data1', colIds: '*'}],
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -1, aclFormula: 'user.Access != "owners" and not rec.Public', permissionsText: 'none',
      }],
      // This alternative is equivalent:
      //    aclFormula: 'user.Access == "owners" or rec.Public', permissionsText: 'all',
      //    aclFormula: '', permissionsText: 'none',
      ['AddTable', 'Data2', [{id: 'A'}, {id: 'B'}]],
      ['AddRecord', 'Data2', null, {A: 1, B: 2}],
    ]);
    assert.deepEqual((await owner.getDocAPI(docId).getRows('Data1')).id, [1, 2, 3]);
    assert.deepEqual((await editor.getDocAPI(docId).getRows('Data1')).id, [1, 3]);

    // Owner can edit all rows, "editor" can only edit public rows.
    await assert.isFulfilled(owner.getDocAPI(docId).updateRows(
      'Data1', { id: [1], A: [99] }));
    await assert.isFulfilled(editor.getDocAPI(docId).updateRows(
      'Data1', { id: [1], A: [99] }));
    await assert.isRejected(editor.getDocAPI(docId).updateRows(
      'Data1', { id: [2], A: [99] }));

    // For other tables, editor has normal rights on rows.
    await assert.isFulfilled(owner.getDocAPI(docId).updateRows(
      'Data2', { id: [1], A: [99] }));
    await assert.isFulfilled(editor.getDocAPI(docId).updateRows(
      'Data2', { id: [1], A: [99] }));
  });

  it('respects row-level access control on updates', async function() {
    await freshDoc();
    // Make a table, and allow update of rows matching a condition.
    await owner.applyUserActions(docId, [
      ['AddTable', 'Data1', [{id: 'A', type: 'Numeric'},
                             {id: 'B', type: 'Numeric'}]],
      ['AddRecord', 'Data1', null, {A: 1, B: 100}],
      ['AddRecord', 'Data1', null, {A: 2, B: 200}],
      ['AddRecord', 'Data1', null, {A: 3, B: 300}],

      ['AddRecord', '_grist_ACLResources', -1, {tableId: 'Data1', colIds: '*'}],
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -1, aclFormula: 'user.Access != "owners" and newRec.B <= rec.B', permissionsText: '-U',
      }],
    ]);
    await assert.isFulfilled(editor.getDocAPI(docId).updateRows(
      'Data1', { id: [1], B: [101] }));
    await assert.isRejected(editor.getDocAPI(docId).updateRows(
      'Data1', { id: [1], B: [99] }));
    await assert.isFulfilled(owner.getDocAPI(docId).updateRows(
      'Data1', { id: [1], B: [98] }));
    await assert.isFulfilled(editor.getDocAPI(docId).updateRows(
      'Data1', { id: [1], B: [99] }));
  });

  it('handles schema changes within a bundle', async function() {
    await freshDoc();
    // Owner limits their own row access to a certain table.
    await owner.applyUserActions(docId, [
      ['AddTable', 'Data1', [{id: 'A', type: 'Numeric'},
                             {id: 'B', type: 'Numeric'}]],
      ['AddRecord', 'Data1', null, {A: 1, B: 100}],
      ['AddRecord', 'Data1', null, {A: 2, B: 200}],
      ['AddRecord', 'Data1', null, {A: 3, B: 100}],
      ['AddTable', 'Data2', [{id: 'A', type: 'Numeric'},
                             {id: 'B', type: 'Numeric'}]],
      ['AddRecord', 'Data2', null, {A: 1, B: 100}],
      ['AddRecord', 'Data2', null, {A: 2, B: 200}],
      ['AddRecord', 'Data2', null, {A: 3, B: 100}],
      ['AddRecord', '_grist_ACLResources', -1, {tableId: 'Data1', colIds: '*'}],
      ['AddRecord', '_grist_ACLResources', -2, {tableId: 'Data2', colIds: '*'}],
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -1, aclFormula: 'user.Access != "owners"', permissionsText: '-U',
      }],
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -2, aclFormula: 'rec.B == 100', permissionsText: '-U',
      }],
    ]);
    await assert.isRejected(editor.applyUserActions(docId, [
      ['UpdateRecord', 'Data2', 3, {A: 99}],
    ]));
    await assert.isFulfilled(editor.applyUserActions(docId, [
      ['UpdateRecord', 'Data2', 2, {A: 99}],
    ]));
    await assert.isRejected(editor.applyUserActions(docId, [
      ['UpdateRecord', 'Data1', 2, {A: 99}],
    ]));
    // Swap Data1 and Data2 names, and check all is well.
    await assert.isFulfilled(editor.applyUserActions(docId, [
      ['RenameTable', 'Data1', 'Data3'],
      ['RenameTable', 'Data2', 'Data1'],
      ['RenameTable', 'Data3', 'Data2'],
      ['UpdateRecord', 'Data1', 2, {A: 99}],
    ]));
    await assert.isRejected(editor.applyUserActions(docId, [
      ['UpdateRecord', 'Data1', 3, {A: 99}],
    ]));
    await assert.isFulfilled(editor.applyUserActions(docId, [
      ['UpdateRecord', 'Data1', 2, {A: 99}],
    ]));
    await assert.isRejected(editor.applyUserActions(docId, [
      ['UpdateRecord', 'Data2', 2, {A: 99}],
    ]));

    // This swaps A and B for Data1 (originally Data2).
    await assert.isFulfilled(editor.applyUserActions(docId, [
      ['RenameColumn', 'Data1', 'A', 'C'],
      ['RenameColumn', 'Data1', 'B', 'A'],
      ['RenameColumn', 'Data1', 'C', 'B'],
      ['UpdateRecord', 'Data1', 2, {B: 99}],
    ]));
    await assert.isRejected(editor.applyUserActions(docId, [
      ['UpdateRecord', 'Data1', 3, {B: 99}],
    ]));
    await assert.isFulfilled(editor.applyUserActions(docId, [
      ['UpdateRecord', 'Data1', 2, {B: 99}],
    ]));
    await assert.isRejected(editor.applyUserActions(docId, [
      ['RenameColumn', 'Data1', 'A', 'C'],
      ['RenameColumn', 'Data1', 'B', 'A'],
      ['RenameColumn', 'Data1', 'C', 'B'],
      ['UpdateRecord', 'Data1', 3, {A: 99}],
    ]));
  });

  it('only owners can change rules', async function() {
    // We currently have hardcoded permission that only owners can edit rules.
    await freshDoc();
    await owner.applyUserActions(docId, [
      ['AddTable', 'Data1', [{id: 'A', type: 'Numeric'},
                             {id: 'B', type: 'Numeric'}]],
      ['AddTable', 'Sensitive', [{id: 'A', type: 'Numeric'},
                                 {id: 'B', type: 'Numeric'}]],
      ['AddRecord', '_grist_ACLResources', -1, {tableId: 'Data1', colIds: '*'}],
      ['AddRecord', '_grist_ACLResources', -2, {tableId: 'Sensitive', colIds: '*'}],
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -1, aclFormula: 'newRec.A != 1', permissionsText: '-U',
      }],
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -2, aclFormula: 'user.Access != "owners"', permissionsText: '-R',
      }],
    ]);
    cliEditor.flush();
    cliOwner.flush();
    await assert.isFulfilled(owner.applyUserActions(docId, [
      ['AddRecord', '_grist_ACLRules', null, {
        resource: 1, aclFormula: 'newRec.A != 1', permissionsText: '-U',
      }],
    ]));
    assert.equal((await cliEditor.readMessage()).type, 'docShutdown');
    assert.equal((await cliOwner.readMessage()).type, 'docShutdown');
    await assert.isRejected(editor.applyUserActions(docId, [
      ['AddRecord', '_grist_ACLRules', null, {
        resource: 1, aclFormula: 'newRec.A != 1', permissionsText: '-U',
      }],
    ]), /Only owners can modify access rules/);
    await assert.isFulfilled(owner.applyUserActions(docId, [
      ['AddRecord', '_grist_ACLRules', null, {
        resource: 1, aclFormula: 'user.Access != "owners"', permissionsText: '-R',
      }]
    ]));

    cliEditor.flush();
    cliOwner.flush();
    await assert.isFulfilled(owner.applyUserActions(docId, [
      ['RenameTable', 'Data1', 'Data2'],
    ]));
    assert.deepEqual(await cliOwner.readDocUserAction(), [
      [ 'RenameTable', 'Data1', 'Data2' ],
      [ 'UpdateRecord', '_grist_Tables', 2, { tableId: 'Data2' } ],
      [ 'UpdateRecord', '_grist_ACLResources', 2, { tableId: 'Data2' } ]
    ]);
    assert.deepEqual(await cliEditor.readDocUserAction(), [
      [ 'RenameTable', 'Data1', 'Data2' ],
      [ 'UpdateRecord', '_grist_Tables', 2, { tableId: 'Data2' } ]
    ]);

    // Editor cannot download doc with some private info.
    await assert.isRejected((await editor.getWorkerAPI(docId)).downloadDoc(docId));

    // Grant editor special access to access rules.
    await owner.applyUserActions(docId, [
      ['AddRecord', '_grist_ACLResources', -1, {tableId: '*SPECIAL', colIds: 'AccessRules'}],
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -1, aclFormula: 'user.Access == "editors"', permissionsText: '+R',
      }],
    ]);
    cliEditor.flush();
    cliOwner.flush();
    await assert.isFulfilled(owner.applyUserActions(docId, [
      ['RenameTable', 'Data2', 'Data3'],
    ]));
    for (const cli of [cliEditor, cliOwner]) {
      assert.deepEqual(await cli.readDocUserAction(), [
        [ 'RenameTable', 'Data2', 'Data3' ],
        [ 'UpdateRecord', '_grist_Tables', 2, { tableId: 'Data3' } ],
        [ 'UpdateRecord', '_grist_ACLResources', 2, { tableId: 'Data3' } ]
      ]);
    }
    // Editor still cannot download doc.
    await assert.isRejected((await editor.getWorkerAPI(docId)).downloadDoc(docId));

    // Grant editor special access to download document.
    await owner.applyUserActions(docId, [
      ['AddRecord', '_grist_ACLResources', -1, {tableId: '*SPECIAL', colIds: 'FullCopies'}],
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -1, aclFormula: 'user.Access == "editors"', permissionsText: '+R',
      }],
    ]);

    // Download should work, and have FullCopies rules/resources removed.
    const download = await (await editor.getWorkerAPI(docId)).downloadDoc(docId);
    const worker = await editor.getWorkerAPI('import');
    const uploadId = await worker.upload(await (download as any).buffer(), 'upload.grist');
    const workspaceId = (await editor.getOrgWorkspaces('current'))[0].id;
    const copyDocId = (await worker.importDocToWorkspace(uploadId, workspaceId)).id;
    assert.deepEqual(await editor.getDocAPI(copyDocId).getRows('_grist_ACLResources'),
                     { id: [ 1, 2, 3, 4 ],
                       colIds: [ '', '*', '*', 'AccessRules' ],
                       tableId: [ '', 'Data3', 'Sensitive', '*SPECIAL' ] });
    assert.deepEqual((await editor.getDocAPI(copyDocId).getRows('_grist_ACLRules')).resource,
                     [ 1, 2, 3, 1, 1, 4 ]);

    // Similarly for a fork.
    cliEditor.flush();
    const forkDocId = (await cliEditor.send("fork", 0)).data.docId as string;
    assert.deepEqual(await editor.getDocAPI(forkDocId).getRows('_grist_ACLResources'),
                     { id: [ 1, 2, 3, 4 ],
                       colIds: [ '', '*', '*', 'AccessRules' ],
                       tableId: [ '', 'Data3', 'Sensitive', '*SPECIAL' ] });
    assert.deepEqual((await editor.getDocAPI(copyDocId).getRows('_grist_ACLRules')).resource,
                     [ 1, 2, 3, 1, 1, 4 ]);

    // Original doc should be unchanged.
    assert.deepEqual(await editor.getDocAPI(docId).getRows('_grist_ACLResources'),
                     { id: [ 1, 2, 3, 4, 5 ],
                       colIds: [ '', '*', '*', 'AccessRules', 'FullCopies' ],
                       tableId: [ '', 'Data3', 'Sensitive', '*SPECIAL', '*SPECIAL' ] });
    assert.deepEqual((await editor.getDocAPI(docId).getRows('_grist_ACLRules')).resource,
                     [ 1, 2, 3, 1, 1, 4, 5 ]);
  });

  it('handles fork ownership gracefully', async function() {
    // Make a document with some data only owners have access to.
    await freshDoc();
    await owner.applyUserActions(docId, [
      ['AddTable', 'Data1', [{id: 'A', type: 'Numeric'}]],
      ['AddRecord', 'Data1', 1, {A: 14}],
      ['AddRecord', 'Data1', 2, {A: 15}],
      ['AddTable', 'Sensitive', [{id: 'A', type: 'Numeric'}]],
      ['AddRecord', 'Sensitive', 1, {A: 16}],
      ['AddRecord', 'Sensitive', 2, {A: 17}],
      ['AddRecord', '_grist_ACLResources', -1, {tableId: 'Sensitive', colIds: '*'}],
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -1, aclFormula: 'user.Access != "owners"', permissionsText: 'none',
      }],
    ]);

    // Check editor can write to public table in regular document mode.
    assert.equal((await cliEditor.send('applyUserActions', 0,
                                       [['AddRecord', 'Data1', null, {A: 99}]])).error,
                 undefined);
    // Check editor cannot read sensitive data.
    assert.match((await cliEditor.send('fetchTable', 0, 'Sensitive')).error!,
                 /Blocked by table read access rules/);
    // Check that in fork mode, editor still cannot read sensitive data.
    await reopenClients({openMode: 'fork'});
    assert.match((await cliEditor.send('fetchTable', 0, 'Sensitive')).error!,
                 /Blocked by table read access rules/);
    // Nor can editor write in (pre)-fork mode.  Need to send an explicit "fork" command
    // to create a different doc to write to (tested elsewhere).
    assert.match((await cliEditor.send('applyUserActions', 0,
                                       [['AddRecord', 'Data1', null, {A: 99}]])).error!,
                 /No write access/);

    // Grant editor special access to copy/download/fork document.
    await owner.applyUserActions(docId, [
      ['AddRecord', '_grist_ACLResources', -1, {tableId: '*SPECIAL', colIds: 'FullCopies'}],
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -1, aclFormula: 'user.Access == "editors"', permissionsText: '+R',
      }],
    ]);

    // Check editor can still write to public table in regular document mode.
    await reopenClients();
    assert.equal((await cliEditor.send('applyUserActions', 0,
                                       [['AddRecord', 'Data1', null, {A: 99}]])).error,
                 undefined);
    // Editor still cannot read sensitive data in regular mode (although they could download
    // it, tested elsewhere).
    assert.match((await cliEditor.send('fetchTable', 0, 'Sensitive')).error!,
                 /Blocked by table read access rules/);

    // But now, if opening in fork mode, editor reads as owner, as if they' already
    // copied everything and become its owner.
    await reopenClients({openMode: 'fork'});
    assert.deepEqual((await cliEditor.send('fetchTable', 0, 'Sensitive')).data.tableData[3],
                     { manualSort: [ 1, 2 ], A: [ 16, 17 ] });
    // Modifications remain forbidden.  Were we to send the 'fork' message,
    // (tested elsewhere) we'd get back a new docId to switch to, and there
    // the editor would be a true owner.
    assert.match((await cliEditor.send('applyUserActions', 0,
                                       [['AddRecord', 'Data1', null, {A: 99}]])).error!,
                 /No write access/);
  });

  it('handles outgoing actions when an action triggers changes in other tables', async function() {
    await freshDoc();

    // Set up a situation where there are two linked tables (a change to Contacts will trigger a
    // change to Interactions), and one table has partial access.
    await owner.applyUserActions(docId, [
      ['AddTable', 'Contacts', [{id: 'Name', type: 'Text'}, {id: 'Show', type: 'Bool'}]],
      ['AddTable', 'Interactions', [
        {id: 'Contact', type: 'Ref:Contacts'},
        {id: 'ContactName', formula: '$Contact.Name'},
      ]],
      ['AddRecord', 'Contacts', -1, {Name: 'Bob', Show: true}],
      ['AddRecord', 'Contacts', -2, {Name: 'Jane', Show: false}],
      ['AddRecord', 'Interactions', -1, {Contact: -1}],
      ['AddRecord', 'Interactions', -2, {Contact: -1}],
      ['AddRecord', 'Interactions', -3, {Contact: -2}],

      ['AddRecord', '_grist_ACLResources', -1, {tableId: 'Contacts', colIds: '*'}],
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -1, aclFormula: 'user.Access != "owners" and not rec.Show', permissionsText: 'none',
      }],
    ]);

    // Connect an editor, so that there is someone to receive filtered outgoing actions.
    cliEditor.flush();

    // Make a change that triggers an update to two different tables. It should succeed.
    await assert.isFulfilled(editor.getDocAPI(docId).updateRows('Contacts', {id: [1], Name: ['Bert']}));

    // Read the broadcast action, and check that it includes both expected updates.
    const docAction1 = await cliEditor.readDocUserAction();
    assert.deepEqual(docAction1, [
      ['UpdateRecord', 'Contacts', 1, { Name: 'Bert' }],
      ['BulkUpdateRecord', 'Interactions', [ 1, 2 ], { ContactName: ['Bert', 'Bert'] }],
    ]);

    // As a secondary test, check that the edit restriction works.
    await assert.isRejected(editor.getDocAPI(docId).updateRows('Contacts', {id: [2], Name: ['Jennifer']}),
      /Blocked by row update access rules/);

    // Check that it didn't trigger a broadcast.
    assert.equal(await isLongerThan(cliEditor.readDocUserAction(), 500), true);
  });

  it('restricts helper columns of restricted user columns', async function() {
    await freshDoc();

    await owner.applyUserActions(docId, [
      ['AddTable', 'Contacts', [{id: 'Name', type: 'Text'}]],
      ['AddTable', 'Interactions', [
        {id: 'Contact', type: 'Ref:Contacts'},
        {id: 'Show', type: 'Bool'},
      ]],

      ['AddRecord', 'Contacts', 1, {Name: 'Bob'}],
      ['AddRecord', 'Contacts', 2, {Name: 'Jane'}],
      ['AddRecord', 'Interactions', 3, {Contact: 1, Show: true}],
      ['AddRecord', 'Interactions', 4, {Contact: 2, Show: false}],

      ['AddRecord', '_grist_ACLResources', -1, {tableId: 'Interactions', colIds: 'Contact'}],
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -1, aclFormula: 'user.Access != "owners" and not rec.Show', permissionsText: 'none',
      }],
    ]);

    cliOwner.flush();
    cliEditor.flush();

    await owner.applyUserActions(docId, [
      // Give Interactions.Contact a display column...
      ['SetDisplayFormula', 'Interactions', null, 8, '$Contact.Name'],

      // ...and a conditional formatting rule column
      ['AddEmptyRule', 'Interactions', 0, 8],
      ['UpdateRecord', '_grist_Tables_column', 11, {'formula': '$Contact.Name == "Bob"'}],

      // Repeat the same for a *field* that uses that column
      ['SetDisplayFormula', 'Interactions', 13, null, '$Contact.Name + "2"'],
      ['AddEmptyRule', 'Interactions', 13, 0],
      ['UpdateRecord', '_grist_Tables_column', 13, {'formula': '$Contact.Name == "Jane"'}],
    ]);

    assert.deepEqual(
      (await cliOwner.readDocUserAction()).slice(-4),
      [
        ["BulkUpdateRecord", "Interactions", [3, 4], {"gristHelper_ConditionalRule": [true, false]}],
        ["BulkUpdateRecord", "Interactions", [3, 4], {"gristHelper_ConditionalRule2": [false, true]}],
        ["BulkUpdateRecord", "Interactions", [3, 4], {"gristHelper_Display": ["Bob", "Jane"]}],
        ["BulkUpdateRecord", "Interactions", [3, 4], {"gristHelper_Display2": ["Bob2", "Jane2"]}],
      ],
    );

    // The helper columns are censored for the editor.
    // They shouldn't actually be 100% censored in outgoing actions,
    // this is a limitation with formulas involving `rec`.
    // When fetching records as below, they're correctly partially censored.
    const censoreds: CellValue[] = [[GristObjCode.Censored], [GristObjCode.Censored]];
    assert.deepEqual(
      (await cliEditor.readDocUserAction()).slice(-4),
      [
        ["BulkUpdateRecord", "Interactions", [3, 4], {"gristHelper_ConditionalRule": censoreds}],
        ["BulkUpdateRecord", "Interactions", [3, 4], {"gristHelper_ConditionalRule2": censoreds}],
        ["BulkUpdateRecord", "Interactions", [3, 4], {"gristHelper_Display": censoreds}],
        ["BulkUpdateRecord", "Interactions", [3, 4], {"gristHelper_Display2": censoreds}],
      ],
    );

    // Check that the columns were added correctly
    const columns = await owner.getDocAPI(docId).getRecords("_grist_Tables_column");
    assert.isTrue(
      isMatch(columns, [
        // Table1
        {id: 1}, {id: 2}, {id: 3}, {id: 4},

        // Contacts
        {id: 5, fields: {parentId: 2, colId: 'manualSort'}},
        {id: 6, fields: {parentId: 2, colId: 'Name', type: 'Text'}},

        // Interactions
        {id: 7, fields: {parentId: 3, colId: 'manualSort'}},
        {id: 8, fields: {parentId: 3, colId: 'Contact', type: 'Ref:Contacts', displayCol: 10, rules: ['L', 11]}},
        {id: 9, fields: {parentId: 3, colId: 'Show', type: 'Bool'}},
        {id: 10, fields: {parentId: 3, colId: 'gristHelper_Display', type: 'Any', formula: '$Contact.Name'}},
        {
          id: 11, fields: {
            parentId: 3, colId: 'gristHelper_ConditionalRule', type: 'Any', formula: '$Contact.Name == "Bob"'
          }
        },
        {id: 12, fields: {parentId: 3, colId: 'gristHelper_Display2', type: 'Any', formula: '$Contact.Name + "2"'}},
        {
          id: 13, fields: {
            parentId: 3, colId: 'gristHelper_ConditionalRule2', type: 'Any', formula: '$Contact.Name == "Jane"'
          }
        },
      ]),
      "Unexpected columns: " + JSON.stringify(columns, null, 4),
    );

    // Check that the field is also correct
    const fields = await owner.getDocAPI(docId).getRecords("_grist_Views_section_field");
    assert.isTrue(
      isMatch(fields[12], {id: 13, fields: {colRef: 8, displayCol: 12, rules: ['L', 13]}}),
      "Unexpected fields: " + JSON.stringify(fields, null, 4),
    );

    const commonColumns = {
      id: [3, 4],
      manualSort: [1, 2],
      Show: [true, false],
    };

    const ownerRows = await owner.getDocAPI(docId).getRows("Interactions");
    assert.deepEqual(ownerRows, {
      ...commonColumns,
      Contact: [1, 2],
      gristHelper_Display: ['Bob', 'Jane'],
      gristHelper_Display2: ['Bob2', 'Jane2'],
      gristHelper_ConditionalRule: [true, false],
      gristHelper_ConditionalRule2: [false, true],
    });

    const editorRows = await editor.getDocAPI(docId).getRows("Interactions");
    assert.deepEqual(editorRows, {
      ...commonColumns,
      Contact: [1, [GristObjCode.Censored]],
      // Helper columns are censored in tandem with the associated user column
      gristHelper_Display: ['Bob', [GristObjCode.Censored]],
      gristHelper_Display2: ['Bob2', [GristObjCode.Censored]],
      gristHelper_ConditionalRule: [true, [GristObjCode.Censored]],
      gristHelper_ConditionalRule2: [false, [GristObjCode.Censored]],
    });
  });

  it('respects row-level access control on creates (without formulas)', async function() {
    await freshDoc();
    // Make a table, and allow creation of rows only matching a condition.
    await owner.applyUserActions(docId, [
      ['AddTable', 'Data1', [{id: 'A', type: 'Numeric'},
                             {id: 'B', type: 'Numeric'}]],
      ['AddRecord', 'Data1', null, {A: 100, B: 50}],
      ['AddRecord', 'Data1', null, {A: 200, B: 150}],
      ['AddRecord', 'Data1', null, {A: 300, B: 250}],

      ['AddRecord', '_grist_ACLResources', -1, {tableId: 'Data1', colIds: '*'}],
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -1, aclFormula: 'user.Access != "owners" and newRec.A <= newRec.B', permissionsText: '-C',
      }],
    ]);
    assert.equal((await owner.getDocAPI(docId).getRows('Data1')).id.length, 3);
    await assert.isFulfilled(editor.getDocAPI(docId).addRows(
      'Data1', { A: [10], B: [1] }));
    assert.equal((await owner.getDocAPI(docId).getRows('Data1')).id.length, 4);
    await assert.isRejected(editor.getDocAPI(docId).addRows(
      'Data1', { A: [1], B: [10] }));
    assert.equal((await owner.getDocAPI(docId).getRows('Data1')).id.length, 4);
  });

  it('respects row-level access control on creates (with formulas)', async function() {
    await freshDoc();
    // Make a table, and allow creation of rows only matching a condition.
    await owner.applyUserActions(docId, [
      ['AddTable', 'Data1', [{id: 'A', type: 'Numeric'},
                             {id: 'B', type: 'Numeric'},
                             {id: 'Good', isFormula: true, formula: '$A > $B'}]],
      ['AddRecord', 'Data1', null, {A: 100, B: 50}],
      ['AddRecord', 'Data1', null, {A: 200, B: 150}],
      ['AddRecord', 'Data1', null, {A: 300, B: 250}],

      ['AddRecord', '_grist_ACLResources', -1, {tableId: 'Data1', colIds: '*'}],
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -1, aclFormula: 'user.Access != "owners" and not newRec.Good', permissionsText: '-C',
      }],
    ]);
    assert.equal((await owner.getDocAPI(docId).getRows('Data1')).id.length, 3);
    await assert.isFulfilled(editor.getDocAPI(docId).addRows(
      'Data1', { A: [10], B: [1] }));
    assert.equal((await owner.getDocAPI(docId).getRows('Data1')).id.length, 4);
    await assert.isRejected(editor.getDocAPI(docId).addRows(
      'Data1', { A: [1], B: [10] }));
    assert.equal((await owner.getDocAPI(docId).getRows('Data1')).id.length, 4);
  });

  it('respects row-level access control on deletes', async function() {
    await freshDoc();
    // Make a table, and allow creation of rows only matching a condition.
    await owner.applyUserActions(docId, [
      ['AddTable', 'Data1', [{id: 'A', type: 'Numeric'},
                             {id: 'B', type: 'Numeric'},
                             {id: 'Good', isFormula: true, formula: '$A > $B'}]],
      ['AddRecord', 'Data1', null, {A: 100, B: 50}],
      ['AddRecord', 'Data1', null, {A: 200, B: 250}],
      ['AddRecord', 'Data1', null, {A: 300, B: 250}],

      ['AddRecord', '_grist_ACLResources', -1, {tableId: 'Data1', colIds: '*'}],
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -1, aclFormula: 'user.Access != "owners" and not rec.Good', permissionsText: '-D',
      }],
    ]);
    assert.equal((await owner.getDocAPI(docId).getRows('Data1')).id.length, 3);
    await assert.isFulfilled(editor.getDocAPI(docId).removeRows(
      'Data1', [1]));
    assert.equal((await owner.getDocAPI(docId).getRows('Data1')).id.length, 2);
    await assert.isRejected(editor.getDocAPI(docId).removeRows(
      'Data1', [2]));
    assert.equal((await owner.getDocAPI(docId).getRows('Data1')).id.length, 2);
  });

  it('can prevent duplicates', async function() {
    await freshDoc();
    // Make a table, and allow creation or update of rows with unique keys.
    await owner.applyUserActions(docId, [
      ['AddTable', 'Data1', [{id: 'A', type: 'Numeric'},
                             {id: 'Count', isFormula: true, formula: 'len(Data1.lookupRecords(A=$A))'}]],
      ['AddRecord', 'Data1', null, {A: 100}],
      ['AddRecord', 'Data1', null, {A: 200}],
      ['AddRecord', 'Data1', null, {A: 300}],

      ['AddRecord', '_grist_ACLResources', -1, {tableId: 'Data1', colIds: '*'}],
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -1,
        aclFormula: 'newRec.Count > 1',
        permissionsText: '-CU',
        memo: 'duplicate check',
      }],
    ]);

    const noop = assertUnchanged(() => owner.getDocAPI(docId).getRows('Data1'));

    // Adding a row with a distinct key should work.
    assert.equal((await owner.getDocAPI(docId).getRows('Data1')).id.length, 3);
    await assert.isFulfilled(owner.getDocAPI(docId).addRows('Data1', { A: [400] }));
    assert.equal((await owner.getDocAPI(docId).getRows('Data1')).id.length, 4);
    // Adding a row with a duplicated key should fail.
    await noop(assertDeniedFor(owner.getDocAPI(docId).addRows( 'Data1', { A: [200] }),
                               ['duplicate check']));
    assert.equal((await owner.getDocAPI(docId).getRows('Data1')).id.length, 4);
    // If original is removed, adding the row should now succeed.
    await assert.isFulfilled(owner.getDocAPI(docId).removeRows('Data1', [2]));
    await assert.isFulfilled(owner.getDocAPI(docId).addRows('Data1', { A: [200] }));
    // Updating a row to duplicate an existing key should fail.
    await noop(assert.isRejected(owner.getDocAPI(docId).updateRows('Data1',
                                                                         { id: [1], A: [200] })));
    // Updating a row to have a new key should succeed.
    await assert.isFulfilled(owner.getDocAPI(docId).updateRows('Data1',
                                                               { id: [1], A: [500] }));
    // Adding rows containing a new duplicate should fail.
    await noop(assert.isRejected(owner.getDocAPI(docId).addRows('Data1', { A: [600, 600] })));

    // A duplicate introduced within an action bundle should cause the bundle to be rejected.
    await noop(assert.isRejected(owner.applyUserActions(docId, [
      ['AddRecord', 'Data1', null, {A: 700}],
      ['UpdateRecord', 'Data1', 1, {A: 700}],
    ])));

    // An action bundle should otherwise succeed.
    await assert.isFulfilled(owner.applyUserActions(docId, [
      ['AddRecord', 'Data1', null, {A: 800}],
      ['UpdateRecord', 'Data1', 1, {A: 700}],
    ]));

    // Adding 700 at this point should be rejected as a duplicate.
    await noop(assert.isRejected(owner.applyUserActions(docId, [
      ['AddRecord', 'Data1', -1, {A: 700}],
    ])));

    // Adding 700 and immediately overwriting should be accepted.
    await assert.isFulfilled(owner.applyUserActions(docId, [
      ['AddRecord', 'Data1', -1, {A: 700}],
      ['UpdateRecord', 'Data1', -1, {A: 750}],
    ]));

    // Again, a duplicate introduced in a bundle should be rejected.
    await noop(assert.isRejected(owner.applyUserActions(docId, [
      ['AddRecord', 'Data1', -1, {A: 760}],
      ['UpdateRecord', 'Data1', -1, {A: 750}],
    ])));
  });

  it('permits indirect changes via formulas', async function() {
    await freshDoc();

    // Make a table with a data column A, and a formula column Count.
    await owner.applyUserActions(docId, [
      ['AddTable', 'Data1', [{id: 'A', type: 'Numeric'},
                             {id: 'Count', isFormula: true, formula: 'len(Data1.lookupRecords(A=$A))'}]],
      ['AddRecord', 'Data1', null, {A: 100}],
      ['AddRecord', 'Data1', null, {A: 200}],
      ['AddRecord', 'Data1', null, {A: 300}],

      // Forbid write access to Count (this is redundant since the data engine forbids
      // writing to a formula column in any case).
      ['AddRecord', '_grist_ACLResources', -1, {tableId: 'Data1', colIds: 'Count'}],
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -1, aclFormula: 'True', permissionsText: '-U',
      }],
    ]);

    // Check initial state of formula column.
    assert.deepEqual((await owner.getDocAPI(docId).getRows('Data1')).Count, [1, 1, 1]);

    // Make a change in data column.
    await assert.isFulfilled(owner.getDocAPI(docId).updateRows('Data1',
                                                               { id: [1], A: [200] }));

    // Check that formula column changed as expected.
    assert.deepEqual((await owner.getDocAPI(docId).getRows('Data1')).Count, [2, 2, 1]);

    // Check that we cannot write to the formula column.
    await assert.isRejected(owner.getDocAPI(docId).updateRows('Data1',
                                                              { id: [1], Count: [200] }),
                            /Can't save value to formula column/);
  });

  it('permits indirect changes via type conversion', async function() {
    await freshDoc();

    // Make a table with a data column A, and make it read-only.
    await owner.applyUserActions(docId, [
      ['AddTable', 'Data1', [{id: 'A', type: 'Int'}]],
      ['AddRecord', 'Data1', null, {A: 100}],
      ['AddRecord', 'Data1', null, {A: 200}],
      ['AddRecord', 'Data1', null, {A: 300}],

      // Forbid write access to column.
      ['AddRecord', '_grist_ACLResources', -1, {tableId: 'Data1', colIds: 'A'}],
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -1,
        aclFormula: 'True',
        permissionsText: '-CUD',
        memo: 'COMPUTER SAYS NO'
      }],
    ]);

    // Check initial state of column.
    assert.deepEqual((await owner.getDocAPI(docId).getRows('Data1')).A, [100, 200, 300]);

    // Try to make a change in data column.
    await assertDeniedFor(owner.getDocAPI(docId).updateRows('Data1',
                                                              { id: [1], A: [200] }),
                          ['COMPUTER SAYS NO']);

    // Convert column in bulk - we have +S bit so we can do this.
    await owner.applyUserActions(docId, [
      ["ModifyColumn", "Data1", "A", {"type": "Text"}]
    ]);

    // Check that column changed as expected.
    assert.deepEqual((await owner.getDocAPI(docId).getRows('Data1')).A, ['100', '200', '300']);
  });

  it('permits indirect changes via simple summary tables', async function() {
    await freshDoc();

    // Make test tables.
    await owner.applyUserActions(docId, [
      ['AddTable', 'Data1', [{id: 'G', type: 'Numeric'}, {id: 'V', type: 'Numeric'}]],
      ['AddRecord', 'Data1', null, {G: 1, V: 10}],
      ['AddRecord', 'Data1', null, {G: 2, V: 20}],
      ['AddRecord', 'Data1', null, {G: 2, V: 20}],
      ['AddTable', 'Data2', [{id: 'A', type: 'Numeric'}]],
    ]);

    // Get tableRef and colRef of column 'G' so we can make a summary table.
    const tableRef = (await owner.getDocAPI(docId).getRows('_grist_Tables',
                                                           {filters: { tableId: ['Data1'] }})).id[0];
    const colRef = (await owner.getDocAPI(docId).getRows('_grist_Tables_column',
                                                         {filters: { colId: ['G'] }})).id[0];

    // Make a summary table.
    await owner.applyUserActions(docId, [
      ['CreateViewSection', tableRef, 0, 'detail', [colRef], null]
    ]);

    // Allow non-owners to edit data table only, not summary table.
    await owner.applyUserActions(docId, [
      ['AddRecord', '_grist_ACLResources', -1, {tableId: '*', colIds: '*'}],
      ['AddRecord', '_grist_ACLResources', -2, {tableId: 'Data1', colIds: '*'}],
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -1, aclFormula: 'user.Access != OWNER', permissionsText: '-CUD',
      }],
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -2, aclFormula: 'user.Access != OWNER', permissionsText: '+CUD',
      }],
    ]);

    // Check summary looks as expected.
    assert.deepEqual((await owner.getDocAPI(docId).getRows('Data1_summary_G')).V, [10, 40]);

    // Make sure that editor can indirectly create a new row in summary, despite access rules.
    await editor.applyUserActions(docId, [
      ['AddRecord', 'Data1', null, {G: 3, V: 5}],
    ]);
    assert.deepEqual((await owner.getDocAPI(docId).getRows('Data1_summary_G')).V, [10, 40, 5]);

    // Make sure that editor can indirectly hide a row in summary.
    await editor.applyUserActions(docId, [
      ['UpdateRecord', 'Data1', 1, {G: 3}],
    ]);
    assert.deepEqual((await owner.getDocAPI(docId).getRows('Data1_summary_G')).V, [40, 15]);

    // Make sure editor cannot directly change Data2.
    await assert.isRejected(editor.applyUserActions(docId, [
      ['AddRecord', 'Data2', null, {A: 1}],
    ]), /Blocked by table create access rules/);
  });

  it('permits indirect changes via flattened summary tables', async function() {
    await freshDoc();

    // Make test tables.
    await owner.applyUserActions(docId, [
      ['AddTable', 'Data1', [{id: 'G', type: 'ChoiceList'}, {id: 'V', type: 'Numeric'}]],
      ['AddRecord', 'Data1', null, {G: ['L', 1, 2], V: 10}],
      ['AddRecord', 'Data1', null, {G: ['L', 2], V: 20}],
      ['AddRecord', 'Data1', null, {G: ['L', 2], V: 20}],
      ['AddTable', 'Data2', [{id: 'A', type: 'Numeric'}]],
    ]);

    // Get tableRef and colRef of column 'G' so we can make a summary table.
    const tableRef = (await owner.getDocAPI(docId).getRows('_grist_Tables',
                                                           {filters: { tableId: ['Data1'] }})).id[0];
    const colRef = (await owner.getDocAPI(docId).getRows('_grist_Tables_column',
                                                         {filters: { colId: ['G'] }})).id[0];

    // Make a summary table.
    await owner.applyUserActions(docId, [
      ['CreateViewSection', tableRef, 0, 'detail', [colRef], null]
    ]);

    // Block create/update/delete to non-owners on summary table.
    // Allow non-owners to edit data table only, not summary table.
    await owner.applyUserActions(docId, [
      ['AddRecord', '_grist_ACLResources', -1, {tableId: '*', colIds: '*'}],
      ['AddRecord', '_grist_ACLResources', -2, {tableId: 'Data1', colIds: '*'}],
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -1, aclFormula: 'user.Access != OWNER', permissionsText: '-CUD',
      }],
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -2, aclFormula: 'user.Access != OWNER', permissionsText: '+CUD',
      }],
    ]);

    // Check summary looks as expected.
    assert.deepEqual((await owner.getDocAPI(docId).getRows('Data1_summary_G')).V, [10, 50]);

    // Make sure that editor can indirectly create a new row in summary, despite access rules.
    await editor.applyUserActions(docId, [
      ['AddRecord', 'Data1', null, {G: ['L', 2, 3, 4], V: 5}],
    ]);
    assert.deepEqual((await owner.getDocAPI(docId).getRows('Data1_summary_G')).V, [10, 55, 5, 5]);

    // Make sure that editor can indirectly hide a row in summary.
    await editor.applyUserActions(docId, [
      ['UpdateRecord', 'Data1', 1, {G: ['L', 3]}],
    ]);
    assert.deepEqual((await owner.getDocAPI(docId).getRows('Data1_summary_G')).V, [45, 15, 5]);

    // Make sure editor cannot directly change Data2.
    await assert.isRejected(editor.applyUserActions(docId, [
      ['AddRecord', 'Data2', null, {A: 1}],
    ]), /Blocked by table create access rules/);
  });

  it('uncensors the raw view section of a source table when a summary table is visible', async function() {
    await freshDoc();
    const docApi = owner.getDocAPI(docId);

    // The doc starts out with one table by default, with three view sections (widgets): one 'normal',
    // one raw, and one record card.
    // Initially, they have no titles. Give them some. Note that naming the raw section 'My Data'
    // also renames the table itself to 'My_Data'.
    await docApi.updateRows('_grist_Views_section', {id: [1, 2], title: ['Widget', 'My Data']});

    // Check the initial tableId and title values.
    let tableIds = (await docApi.getRows('_grist_Tables')).tableId;
    let sectionTitles = (await docApi.getRows('_grist_Views_section')).title;
    assert.deepEqual(tableIds, ['My_Data']);
    assert.deepEqual(sectionTitles, ['Widget', 'My Data', '']);

    // Deny all access to the table.
    await owner.applyUserActions(docId, [
      ['AddRecord', '_grist_ACLResources', -1, {tableId: 'My_Data', colIds: '*'}],
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -1, aclFormula: null, permissionsText: '-CRUD',
      }],
    ]);

    // Now all those values are 'censored', i.e. blank.
    tableIds = (await docApi.getRows('_grist_Tables')).tableId;
    sectionTitles = (await docApi.getRows('_grist_Views_section')).title;
    assert.deepEqual(tableIds, ['']);
    assert.deepEqual(sectionTitles, ['', '', '']);

    // Make a summary table on the table grouped by column 'A'.
    await owner.applyUserActions(docId, [
      ['CreateViewSection', 1, 0, 'detail', [2], null]
    ]);

    // Get the values again.
    tableIds = (await docApi.getRows('_grist_Tables')).tableId;
    sectionTitles = (await docApi.getRows('_grist_Views_section')).title;

    // The source tableId is still hidden, and we now have a new summary table.
    assert.deepEqual(tableIds, ['', 'My_Data_summary_A']);

    assert.deepEqual(sectionTitles, [
      // Source table sections. The normal section is still hidden, but the raw section title is revealed.
      '', 'My Data', '',
      // Summary table sections. These aren't hidden, they just have no titles.
      '', '',
    ]);
  });

  it('merges rec and newRec for creations and deletions', async function() {
    await freshDoc();

    // Make a table with a data column A, and allow user to add/remove odd rows.
    await owner.applyUserActions(docId, [
      ['AddTable', 'Data1', [{id: 'A', type: 'Int'}]],
      ['AddRecord', 'Data1', null, {A: 100}],
      ['AddRecord', 'Data1', null, {A: 201}],
      ['AddRecord', 'Data1', null, {A: 301}],

      // Forbid write access to column.
      ['AddRecord', '_grist_ACLResources', -1, {tableId: 'Data1', colIds: '*'}],
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -1, aclFormula: 'rec.A % 2 == 0', permissionsText: '-CD', memo: 'STOP1',
      }],
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -1, aclFormula: 'newRec.A % 2 == 0', permissionsText: '-CD', memo: 'STOP2',
      }],
    ]);

    // Cannot add a row with even A.
    await assertDeniedFor(owner.getDocAPI(docId).addRows('Data1', {A: [500]}),
                          ['STOP1', 'STOP2']);

    // Cannot remove a row with even A.
    await assertDeniedFor(owner.getDocAPI(docId).removeRows('Data1', [1]),
                          ['STOP1', 'STOP2']);

    // Can add a row with odd A.
    await assert.isFulfilled(owner.getDocAPI(docId).addRows('Data1', {A: [501]}));

    // Can remove a row with odd A.
    await assert.isFulfilled(owner.getDocAPI(docId).removeRows('Data1', [2]));
  });

  it('newRec behavior in a long or mixed bundle is as expected', async function() {
    await freshDoc();
    await owner.applyUserActions(docId, [
      ['AddTable', 'Data1', [{id: 'A', type: 'Numeric'},
                             {id: 'B', isFormula: true, formula: '$A + 1'},
                             {id: 'C'}]],
      ['AddRecord', 'Data1', null, {A: 101}],
      ['AddRecord', 'Data1', null, {A: 201}],
      ['AddRecord', 'Data1', null, {A: 301}],
      ['AddRecord', 'Data1', null, {A: 401}],
      ['AddRecord', 'Data1', null, {A: 501}],
      ['AddTable', 'Data2', [{id: 'A', type: 'Numeric'},
                             {id: 'B', isFormula: true, formula: '$A + 1'}]],
      ['AddRecord', 'Data2', null, {A: 101}],
      ['AddRecord', 'Data2', null, {A: 201}],
      ['AddRecord', 'Data2', null, {A: 301}],
      ['AddRecord', 'Data2', null, {A: 401}],

      ['AddRecord', '_grist_ACLResources', -1, {tableId: 'Data1', colIds: '*'}],
      ['AddRecord', '_grist_ACLResources', -2, {tableId: 'Data2', colIds: '*'}],
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -1, aclFormula: 'newRec.B % 2 != 0', permissionsText: '-CU',
      }],
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -2, aclFormula: 'newRec.B % 2 != 0', permissionsText: '-CU',
      }],
    ]);

    // It is ok for rows to temporarily disobey newRec constraint.
    await assert.isFulfilled(owner.applyUserActions(docId, [
      ['UpdateRecord', 'Data1', 1, {A: 91}],
      ['UpdateRecord', 'Data1', 2, {A: 92}],
      ['UpdateRecord', 'Data1', 2, {A: 93}],
      ['UpdateRecord', 'Data1', 3, {A: 94}],
      ['UpdateRecord', 'Data2', 4, {A: 96}],
      ['UpdateRecord', 'Data2', 4, {A: 97}],
      ['AddRecord', 'Data2', 5, {}],
      ['UpdateRecord', 'Data2', 5, {A: 99}],
      ['UpdateRecord', 'Data1', 3, {A: 95}],
    ]));

    // newRec behavior survives table renames.
    await assert.isFulfilled(owner.applyUserActions(docId, [
      ['UpdateRecord', 'Data1', 2, {A: 6}],
      ['RenameTable', 'Data1', 'Data11'],
      ['UpdateRecord', 'Data11', 2, {A: 7}],
    ]));

    // newRec behavior cannot at this time survive column renames.
    await assert.isRejected(owner.applyUserActions(docId, [
      ['UpdateRecord', 'Data11', 2, {A: 4}],
      ['RenameColumn', 'Data11', 'B', 'BB'],
      ['UpdateRecord', 'Data11', 2, {A: 5}],
    ]), /Blocked by row update access rules/);
  });

  it('rules survive schema changes within a bundle', async function() {
    // This is important because of renames, which propagate to ACL resources and rules.
    // But then again, not that important since in-bundle changes are funky because of
    // delayed formula updates.
    await freshDoc();
    await owner.applyUserActions(docId, [
      ['AddTable', 'Data1', [{id: 'A', type: 'Numeric'},
                             {id: 'B', type: 'Numeric'}]],
      ['AddRecord', 'Data1', null, {A: 0, B: 0}],
      ['AddTable', 'Data2', [{id: 'A', type: 'Numeric'}]],

      ['AddRecord', '_grist_ACLResources', -1, {tableId: 'Data1', colIds: 'A'}],
      ['AddRecord', '_grist_ACLResources', -2, {tableId: 'Data1', colIds: '*'}],
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -1, aclFormula: 'rec.B > 0', permissionsText: '+U', memo: 'me I did it',
      }],
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -1, aclFormula: '', permissionsText: '-U',
      }],
    ]);
    await assert.isFulfilled(owner.applyUserActions(docId, [
      ['UpdateRecord', 'Data1', 1, {B: 1}],
      ['UpdateRecord', 'Data1', 1, {A: 20}],
      ['UpdateRecord', 'Data1', 1, {B: 2}],
      ['RenameColumn', 'Data1', 'B', 'BB'],
      ['RenameTable', 'Data1', 'Data11'],
      ['UpdateRecord', 'Data11', 1, {A: 21}],
      ['RenameColumn', 'Data11', 'BB', 'B'],
      ['RenameTable', 'Data11', 'Data1'],
    ]));
    await assert.isRejected(owner.applyUserActions(docId, [
      ['UpdateRecord', 'Data1', 1, {B: 1}],
      ['UpdateRecord', 'Data1', 1, {A: 20}],
      ['UpdateRecord', 'Data1', 1, {B: 0}],
      ['RenameColumn', 'Data1', 'B', 'BB'],
      ['RenameTable', 'Data1', 'Data11'],
      ['UpdateRecord', 'Data11', 1, {A: 21}],
      ['RenameColumn', 'Data11', 'BB', 'B'],
      ['RenameTable', 'Data11', 'Data1'],
    ]), /Blocked by .* access rules/);
  });

  it('can limit workflow', async function() {
    await freshDoc();
    // Make a table with a choice column containing PENDING, STARTED, and FINISHED, with
    // only modification allowed to that column being to increment it.
    await owner.applyUserActions(docId, [
      ['AddTable', 'Data1', [{id: 'Status', type: 'Choice'},
                             {id: 'StatusIndex', isFormula: true,
                              formula: 'try:\n\treturn ["PENDING", "STARTED", "FINISHED"]' +
                              '.index($Status)\nexcept:\n\treturn -1'}]],
      ['AddRecord', 'Data1', null, {Status: 'PENDING'}],
      ['AddRecord', 'Data1', null, {Status: 'STARTED'}],
      ['AddRecord', 'Data1', null, {Status: 'FINISHED'}],

      ['AddRecord', '_grist_ACLResources', -1, {tableId: 'Data1', colIds: 'Status'}],
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -1, aclFormula: 'newRec.StatusIndex <= rec.StatusIndex', permissionsText: '-U',
      }],
    ]);
    const api = owner.getDocAPI(docId);
    // PENDING -> STARTED allowed.
    await assert.isFulfilled(api.updateRows('Data1', { id: [1], Status: ['STARTED'] }));
    // STARTED -> PENDING forbidden.
    await assert.isRejected(api.updateRows('Data1', { id: [1], Status: ['PENDING'] }));
    // STARTED -> FINISHED allowed.
    await assert.isFulfilled(api.updateRows('Data1', { id: [1], Status: ['FINISHED'] }));
    // FINISHED -> earlier state forbidden.
    await assert.isRejected(api.updateRows('Data1', { id: [1], Status: ['STARTED'] }));
    await assert.isRejected(api.updateRows('Data1', { id: [1], Status: ['PENDING'] }));
    await assert.isRejected(api.updateRows('Data1', { id: [1], Status: ['...'] }));
    // This next "change" succeeds because the user action is translated into a no-op
    // by the data engine, and that no-op is permitted.
    await assert.isFulfilled(api.updateRows('Data1', { id: [1], Status: ['FINISHED'] }));
  });

  it('respects user-private tables', async function() {
    await freshDoc();

    const editorProfile = await editor.getUserProfile();

    // Make a Private table and mark it as user-only (using temporary representation).
    // Make a Public table without any particular access control.
    await owner.applyUserActions(docId, [
      ['AddTable', 'Private', [{id: 'A'}]],
      ['AddRecord', '_grist_ACLResources', -1, {tableId: 'Private', colIds: '*'}],
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -1,
        aclFormula: `user.UserID == ${editorProfile.id}`,
        permissionsText: 'all',
        memo: 'editor check',
      }],
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -1, aclFormula: '', permissionsText: 'none',
      }],
      ['AddTable', 'Public', [{id: 'A'}]],
    ]);

    // Owner can access only the public table.
    await assertDeniedFor(owner.getDocAPI(docId).getRows('Private'), ['editor check']);
    await assert.isFulfilled(owner.getDocAPI(docId).getRows('Public'));

    // Editor can access both tables.
    await assert.isFulfilled(editor.getDocAPI(docId).getRows('Private'));
    await assert.isFulfilled(editor.getDocAPI(docId).getRows('Public'));

    // There are a lot of things the owner can still do, because they are
    // an owner - including downloading doc, changing access rules etc, editing
    // the table.  But the table will be hidden in the client, making it difficult
    // to accidentally edit/view through it at least.
  });

  it('allows characteristic tables', async function() {
    await freshDoc();

    const editorProfile = await editor.getUserProfile();

    await owner.applyUserActions(docId, [
      ['AddTable', 'Seattle', [{id: 'A'}]],
      ['AddTable', 'Zones', [{id: 'Email'}, {id: 'City'}]],
      ['AddRecord', 'Zones', null, {Email: editorProfile.email, City: 'Seattle'}],
      ['AddRecord', '_grist_ACLResources', -1, {tableId: '*', colIds: '*'}],
      ['AddRecord', '_grist_ACLResources', -2, {tableId: 'Seattle', colIds: '*'}],
      ['AddRecord', '_grist_ACLResources', -3, {tableId: 'Zones', colIds: '*'}],
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -1, userAttributes: JSON.stringify({
          name: 'Zone',
          tableId: 'Zones',
          charId: 'Email',
          lookupColId: 'Email',
        })
      }],
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -2,
        aclFormula: 'user.Zone.City != "Seattle"',
        permissionsText: 'none',
        memo: 'city check',
      }],
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -3,
        aclFormula: 'user.Access != "owners"',
        permissionsText: 'none',
        memo: 'owner check',
      }],
    ]);

    await assertDeniedFor(owner.getDocAPI(docId).getRows('Seattle'), ['city check']);
    await assert.isFulfilled(owner.getDocAPI(docId).getRows('Zones'));

    await assert.isFulfilled(editor.getDocAPI(docId).getRows('Seattle'));
    await assertDeniedFor(editor.getDocAPI(docId).getRows('Zones'), ['owner check']);
  });

  it('allows characteristic tables to control row access', async function() {
    await freshDoc();

    const ownerProfile = await owner.getUserProfile();
    const editorProfile = await editor.getUserProfile();

    await owner.applyUserActions(docId, [
      ['AddTable', 'Leads', [{id: 'Name'}, {id: 'Place'}]],
      ['AddRecord', 'Leads', null, {Name: 'Yi Wen', Place: 'Seattle'}],
      ['AddRecord', 'Leads', null, {Name: 'Zeng Hua', Place: 'Seattle'}],
      ['AddRecord', 'Leads', null, {Name: 'Tao Ping', Place: 'Boston'}],
      ['AddTable', 'Zones', [{id: 'Email'}, {id: 'City'}]],
      ['AddRecord', 'Zones', null, {Email: editorProfile.email, City: 'Seattle'}],
      ['AddRecord', 'Zones', null, {Email: ownerProfile.email, City: 'Boston'}],
      ['AddRecord', '_grist_ACLResources', -1, {tableId: '*', colIds: '*'}],
      ['AddRecord', '_grist_ACLResources', -2, {tableId: 'Leads', colIds: '*'}],
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -1, userAttributes: JSON.stringify({
          name: 'Zone',
          tableId: 'Zones',
          charId: 'Email',
          lookupColId: 'Email',
        })
      }],
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -2, aclFormula: 'user.Zone.City != rec.Place', permissionsText: 'none',
      }],
    ]);

    // Editor sees Seattle rows.
    assert.deepEqual((await editor.getDocAPI(docId).getRows('Leads')).id, [1, 2]);

    // Owner sees Boston rows.
    assert.deepEqual((await owner.getDocAPI(docId).getRows('Leads')).id, [3]);
  });

  it('respects column level access denial', async function() {
    await freshDoc();

    // Make a table with 4 columns, only 2 of which should be available to non-owners.
    await owner.applyUserActions(docId, [
      ['AddTable', 'Data1', [{id: 'A', type: 'Numeric'}, {id: 'B', type: 'Numeric'},
                             {id: 'C', isFormula: true, formula: '$A + $B'},
                             {id: 'D', isFormula: true, formula: '$A - $B'}]],
      ['AddRecord', 'Data1', null, {A: 10, B: 4}],
      ['AddRecord', 'Data1', null, {A: 20, B: 5}],
      ['AddRecord', '_grist_ACLResources', -1, {tableId: 'Data1', colIds: 'A,C'}],
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -1, aclFormula: 'user.Access != "owners"', permissionsText: 'none',
      }],
    ]);

    const expect: TableColValues = {
      id: [1, 2],
      manualSort: [1, 2],
      A: [10, 20],
      B: [4, 5],
      C: [14, 25],
      D: [6, 15],
    };
    assert.deepEqual((await owner.getDocAPI(docId).getRows('Data1')), expect);
    delete expect.A;
    delete expect.C;
    assert.deepEqual((await editor.getDocAPI(docId).getRows('Data1')), expect);
  });

  it('respects column level access granting', async function() {
    await freshDoc();

    // Make a table with 4 columns, only 2 of which should be available to non-owners.
    // Flips previous test by defaulting to denying columns, then granting access to
    // those we want to share (rather than denying individual columns we don't wish to
    // share).
    await owner.applyUserActions(docId, [
      ['AddTable', 'Data1', [{id: 'A', type: 'Numeric'}, {id: 'B', type: 'Numeric'},
                             {id: 'C', isFormula: true, formula: '$A + $B'},
                             {id: 'D', isFormula: true, formula: '$A - $B'}]],
      ['AddRecord', 'Data1', null, {A: 10, B: 4}],
      ['AddRecord', 'Data1', null, {A: 20, B: 5}],
      ['AddRecord', '_grist_ACLResources', -1, {tableId: 'Data1', colIds: '*'}],
      ['AddRecord', '_grist_ACLResources', -2, {tableId: 'Data1', colIds: 'B,D'}],
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -2, aclFormula: '', permissionsText: 'all',
      }],
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -1, aclFormula: 'user.Access != "owners"', permissionsText: 'none',
      }],
    ]);

    const expect: TableColValues = {
      id: [1, 2],
      manualSort: [1, 2],
      A: [10, 20],
      B: [4, 5],
      C: [14, 25],
      D: [6, 15],
    };
    assert.deepEqual((await owner.getDocAPI(docId).getRows('Data1')), expect);
    delete expect.A;
    delete expect.C;
    assert.deepEqual((await editor.getDocAPI(docId).getRows('Data1')), expect);
  });

  it('only respects read+update permissions in column-level rules', async function() {
    // Seed rules previously could result in column-level rules that could contain create+delete
    // permissions. Even if those appear in rules, we should ignore them.
    await freshDoc();

    // Create a table with columns A, B. Table denies access, but column A allows all. This
    // situation used to be easy to get into with seed rules when they didn't trim permission bits.
    await owner.applyUserActions(docId, [
      ['AddTable', 'Data1', [{id: 'A', type: 'Numeric'}, {id: 'B', type: 'Numeric'}]],
      ['AddRecord', 'Data1', null, {A: 10, B: 4}],
      ['AddRecord', 'Data1', null, {A: 20, B: 5}],
      ['AddRecord', '_grist_ACLResources', -1, {tableId: 'Data1', colIds: '*'}],
      ['AddRecord', '_grist_ACLResources', -2, {tableId: 'Data1', colIds: 'A'}],
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -2, aclFormula: '', permissionsText: '+CRUD',
      }],
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -1, aclFormula: '', permissionsText: '+R-UCD',
      }],
    ]);

    // Check that we can fetch all data, no restrictions there.
    assert.deepEqual((await owner.getDocAPI(docId).getRows('Data1')), {
      id: [1, 2],
      manualSort: [1, 2],
      A: [10, 20],
      B: [4, 5],
    });

    // Check that we cannot add or delete records (despite column rule seeming to allow it).
    await assert.isRejected(owner.applyUserActions(docId, [
      ["AddRecord", "Data1", null, {"A": 30}],
    ]), /Blocked by table create access rules/);

    await assert.isRejected(owner.applyUserActions(docId, [
      ["RemoveRecord", "Data1", 2],
    ]), /Blocked by table delete access rules/);

    // The column rule does its job: allows update to column A.
    await owner.applyUserActions(docId, [
      ["UpdateRecord", "Data1", 2, {"A": 2000}]
    ]);

    // But the table rule applies to column B.
    await assert.isRejected(owner.applyUserActions(docId, [
      ["UpdateRecord", "Data1", 2, {"B": 500}],
    ]), /Blocked by column update access rules/);

    assert.deepEqual((await owner.getDocAPI(docId).getRows('Data1')), {
      id: [1, 2],
      manualSort: [1, 2],
      A: [10, 2000],
      B: [4, 5],
    });
  });

  it('always allows Calculate action', async function() {
    await freshDoc();

    // Make a cell set to `=NOW()` and forbid updating it.
    await owner.applyUserActions(docId, [
      ['AddTable', 'Data1', [{id: 'Now', isFormula: true, formula: 'NOW()'}]],
      ['AddRecord', 'Data1', null, {}],
      ['AddRecord', '_grist_ACLResources', -1, {tableId: 'Data1', colIds: '*'}],
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -1, aclFormula: '', permissionsText: '-U',
      }],
      ['AddTable', 'Private', [{id: 'A'}]],
    ]);

    const now1 = (await owner.getDocAPI(docId).getRows('Data1')).Now[0];
    await owner.getDocAPI(docId).forceReload();
    const now2 = (await owner.getDocAPI(docId).getRows('Data1')).Now[0];
    assert.notDeepEqual(now1, now2);
  });

  it('can undo changes partially if all are not permitted', async function() {
    await freshDoc();

    await owner.applyUserActions(docId, [
      ['AddTable', 'Data1', [{id: 'A', type: 'Int'},  // editor has full rights
                             {id: 'B', type: 'Int'},  // editor can read only
                             {id: 'C', type: 'Int'},  // editor can edit on some rows
                             {id: 'D', type: 'Int'},  // editor can edit on some rows
                             {id: 'E', type: 'Int'},  // editor cannot view or edit
                             {id: 'F', isFormula: true, formula: '$A'}]],  // read only
      ['AddRecord', 'Data1', null, {A: 10, B: 10, C: 10, D: 10, E: 10}], //  x  x
      ['AddRecord', 'Data1', null, {A: 11, B: 11, C: 11, D: 11, E: 11}],
      ['AddRecord', 'Data1', null, {A: 12, B: 12, C: 12, D: 12, E: 12}], //  x
      ['AddRecord', 'Data1', null, {A: 13, B: 13, C: 13, D: 13, E: 13}], //     x
      ['AddRecord', '_grist_ACLResources', -1, {tableId: 'Data1', colIds: '*'}],
      ['AddRecord', '_grist_ACLResources', -2, {tableId: 'Data1', colIds: 'B'}],
      ['AddRecord', '_grist_ACLResources', -3, {tableId: 'Data1', colIds: 'C'}],
      ['AddRecord', '_grist_ACLResources', -4, {tableId: 'Data1', colIds: 'D'}],
      ['AddRecord', '_grist_ACLResources', -5, {tableId: 'Data1', colIds: 'E'}],
      ['AddRecord', '_grist_ACLResources', -6, {tableId: 'Data1', colIds: 'F'}],
      ['AddRecord', '_grist_ACLRules', null, {
        // editor can only create or delete rows with A odd.
        resource: -1, aclFormula: 'user.Access != OWNER and rec.A % 2 == 1', permissionsText: '-CD',
      }],
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -2, aclFormula: 'user.Access != OWNER', permissionsText: '-U',
      }],
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -3, aclFormula: 'user.Access != OWNER and rec.id % 2 == 1', permissionsText: '-U',
      }],
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -4, aclFormula: 'user.Access != OWNER and rec.id % 3 == 1', permissionsText: '-U',
      }],
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -5, aclFormula: 'user.Access != OWNER', permissionsText: 'none',
      }],
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -6, aclFormula: 'user.Access != OWNER', permissionsText: '-U',
      }],
    ]);

    // Share the document with everyone as an editor.
    await owner.updateDocPermissions(docId, { users: { 'everyone@getgrist.com': 'editors' } });

    // Check that a (fake) undo that affects only material user has edit rights on works.
    const expected = await owner.getDocAPI(docId).getRows('Data1');
    await applyAsUndo(cliEditor, [['UpdateRecord', 'Data1', 1, {A: 55}]]);
    expected.A[0] = 55;
    expected.F[0] = 55;
    assert.deepEqual(await owner.getDocAPI(docId).getRows('Data1'), expected);

    // Check that an undo that includes a change to a column the user cannot edit has that
    // change stripped.
    await applyAsUndo(cliEditor, [['UpdateRecord', 'Data1', 1, {A: 56, B: 99, E: 99}]]);
    expected.A[0] = 56;
    expected.F[0] = 56;
    assert.deepEqual(await owner.getDocAPI(docId).getRows('Data1'), expected);

    // Check that changes to specific cells the user cannot edit are also stripped.
    await applyAsUndo(cliEditor, [['BulkUpdateRecord', 'Data1', [1, 2, 3, 4],
                                   {A: [60, 71, 81, 90],
                                    C: [100, 110, 120, 130],
                                    D: [140, 150, 160, 170]}]]);
    expected.F[0] = expected.A[0] = 60;
    expected.F[1] = expected.A[1] = 71;
    expected.F[2] = expected.A[2] = 81;
    expected.F[3] = expected.A[3] = 90;
    expected.C[1] = 110;
    expected.C[3] = 130;
    expected.D[1] = 150;
    expected.D[2] = 160;
    assert.deepEqual(await owner.getDocAPI(docId).getRows('Data1'), expected);

    // Check that adds and removes work or are blocked as expected.
    // Editor can only create/delete rows with A odd.
    await applyAsUndo(cliEditor, [
      ['AddRecord', 'Data1', 999, {A: 77}],   // should be skipped, A must be even
      ['BulkRemoveRecord', 'Data1', [1, 2]],   // should skip rowId 2, A must be even
    ]);
    for (const key of Object.keys(expected)) {
      // Only first row is removed; no addition.
      pruneArray(expected[key], [0]);
    }
    assert.deepEqual(await owner.getDocAPI(docId).getRows('Data1'), expected);

    await applyAsUndo(cliEditor, [
      ['AddRecord', 'Data1', 1000, {A: 88}],   // should be allowed, A is even.
      ['BulkAddRecord', 'Data1', [1001, 1002], {A: [90, 91]}], // first should be allowed
    ]);
    expected.id.push(1000, 1001);
    expected.A.push(88, 90);
    expected.B.push(0, 0);
    expected.C.push(0, 0);
    expected.D.push(0, 0);
    expected.E.push(0, 0);
    expected.F.push(88, 90);
    expected.manualSort.push(null, null);  // perhaps in a real undo these would have been set in DocActions?
    assert.deepEqual(await owner.getDocAPI(docId).getRows('Data1'), expected);
  });

  it('getAclResources exposes all tableIds and colIds to those with access rules access', async function() {
    await freshDoc();
    await owner.applyUserActions(docId, [
      ['AddTable', 'Data1', [{id: 'A', type: 'Numeric'}, {id: 'B', type: 'Numeric'}]],
      ['AddTable', 'Data2', [{id: 'C', type: 'Numeric'}, {id: 'D', type: 'Numeric'}]],
      ['AddRecord', '_grist_ACLResources', -1, {tableId: 'Data1', colIds: 'A'}],
      ['AddRecord', '_grist_ACLResources', -2, {tableId: 'Data2', colIds: '*'}],
      // Nobody gets access.
      ['AddRecord', '_grist_ACLRules', null, {resource: -1, aclFormula: '', permissionsText: 'none'}],
      ['AddRecord', '_grist_ACLRules', null, {resource: -2, aclFormula: '', permissionsText: 'none'}],
    ]);

    // Check that the owner does not see the blocked resources normally.
    const data1 = await owner.getDocAPI(docId).getRows('Data1');
    assert.property(data1, 'B');
    assert.notProperty(data1, 'A');
    await assert.isRejected(owner.getDocAPI(docId).getRows('Data2'));

    // But the owner sees them in getAclResources call. This call is available via the websocket.
    assert.deepInclude((await cliOwner.send("getAclResources", 0)).data.tables, {
      Data1: {
        title: 'Data1',
        colIds: ['id', 'manualSort', 'A', 'B'],
        groupByColLabels: null
      },
      Data2: {
        title: 'Data2',
        colIds: ['id', 'manualSort', 'C', 'D'],
        groupByColLabels: null
      },
    });

    // Others can NOT call getAclResources.
    assert.match((await cliEditor.send("getAclResources", 0)).error!, /Cannot list ACL resources/);

    // Grant access to Access Rules.
    await owner.applyUserActions(docId, [
      ['AddRecord', '_grist_ACLResources', -1, {tableId: '*SPECIAL', colIds: 'AccessRules'}],
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -1, aclFormula: 'user.Access == "editors"', permissionsText: '+R',
      }],
    ]);

    // Now others CAN call getAclResources.
    assert.deepInclude((await cliEditor.send("getAclResources", 0)).data.tables, {
      Data1: {
        title: 'Data1',
        colIds: ['id', 'manualSort', 'A', 'B'],
        groupByColLabels: null
      },
      Data2: {
        title: 'Data2',
        colIds: ['id', 'manualSort', 'C', 'D'],
        groupByColLabels: null
      },
    });
  });

  it('allows column conversions in the presence of per-row rules', async function() {
    await freshDoc();
    const results = await owner.applyUserActions(docId, [
      ['AddTable', 'Data1', [{id: 'A'}, {id: 'locked', type: 'Bool'}]],
      ['AddColumn', 'Data1', 'B', {type: 'Text', isFormula: false}],
      ['AddRecord', 'Data1', null, {A: 1, locked: true}],
      ['AddRecord', 'Data1', null, {A: 2, locked: true}],
      ['AddRecord', 'Data1', null, {A: 3, locked: false}],

      ['AddRecord', '_grist_ACLResources', -1, {tableId: 'Data1', colIds: '*'}],
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -1, aclFormula: 'rec.locked and user.Access != "owners"', permissionsText: '+R-CUD',
      }],
    ]);

    // Get the metadata rowId of column B in table Data1.
    const colRef = results.retValues[1].colRef;

    // Cell changes in a column conversion will bypass access control.  If the user has the
    // permissionn to change the schema, then the column conversion will be permitted.
    // (this test used to be more elaborate before this was true).
    await assert.isFulfilled(editor.applyUserActions(docId,
       [['UpdateRecord', '_grist_Tables_column', colRef, {type: 'Numeric'}]]));
  });

  // Checks for a bug in filtering first row.
  it('can filter out first row correctly', async function() {
    await freshDoc();
    await owner.applyUserActions(docId, [
      ['AddTable', 'Data1', [{id: 'A', type: 'Numeric'},
                             {id: 'B', type: 'Numeric'},
                             {id: 'Sum', isFormula: true, formula: '$A + $A'}]],
      ['AddRecord', 'Data1', null, {A: 100, B: 50}],
      ['AddRecord', 'Data1', null, {A: 200, B: 150}],
      ['AddRecord', 'Data1', null, {A: 300, B: 250}],

      ['AddRecord', '_grist_ACLResources', -1, {tableId: 'Data1', colIds: '*'}],
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -1, aclFormula: 'user.Access != "owners" and rec.A != 7', permissionsText: '-R',
      }],
    ]);
    cliOwner.flush();
    cliEditor.flush();

    // Change formula, which changes data in all rows, which then all need filtering out.
    await owner.applyUserActions(docId, [
      ['ModifyColumn', 'Data1', 'Sum', {formula: '$A + $B'}]
    ]);
    let fullResult = await cliOwner.readDocUserAction();
    let filteredResult = await cliEditor.readDocUserAction();
    assert.lengthOf(fullResult, 3);
    assert.lengthOf(filteredResult, 2);
    assert.deepEqual(fullResult.slice(0, 2), filteredResult);
    assert.deepEqual(fullResult[2].slice(0, 2), ['BulkUpdateRecord', 'Data1']);

    // Flip on a row to make sure it shows up.
    await owner.applyUserActions(docId, [
      ['UpdateRecord', 'Data1', 3, {A: 7}]
    ]);
    fullResult = await cliOwner.readDocUserAction();
    filteredResult = await cliEditor.readDocUserAction();
    assert.deepEqual(fullResult, [
      [ 'UpdateRecord', 'Data1', 3, { A: 7 } ],
      [ 'UpdateRecord', 'Data1', 3, { Sum: 257 } ]
    ]);
    assert.deepEqual(filteredResult, [
      [ 'BulkAddRecord', 'Data1', [3], { manualSort: [3], A: [7], B: [250], Sum: [550] } ],
      [ 'UpdateRecord', 'Data1', 3, { Sum: 257 } ]
    ]);

    // Flip on first row to make sure it shows up.
    await owner.applyUserActions(docId, [
      ['UpdateRecord', 'Data1', 1, {A: 7}]
    ]);
    fullResult = await cliOwner.readDocUserAction();
    filteredResult = await cliEditor.readDocUserAction();
    assert.deepEqual(fullResult, [
      [ 'UpdateRecord', 'Data1', 1, { A: 7 } ],
      [ 'UpdateRecord', 'Data1', 1, { Sum: 57 } ]
    ]);
    assert.deepEqual(filteredResult, [
      [ 'BulkAddRecord', 'Data1', [1], { manualSort: [1], A: [7], B: [50], Sum: [150] } ],
      [ 'UpdateRecord', 'Data1', 1, { Sum: 57 } ]
    ]);
  });

  for (const first of ['editor', 'owner', 'any'] as const) {
    it(`can censor specific cells in a column (${first} first)`, async function() {
      if (first !== 'any') {
        sandbox.stub(DocClientsDeps, 'BROADCAST_ORDER').value('series');
      }

      // Create some column rules that control read permission based on other columns.
      // Add a rule that controls overall row read permission to check it interacts ok.
      await freshDoc();
      await owner.applyUserActions(docId, [
        ['AddTable', 'Data1', [{id: 'A', type: 'Numeric'},
                               {id: 'B', type: 'Numeric'},
                               {id: 'C', type: 'Numeric'},
                               {id: 'D', type: 'Numeric'}]],
        ['AddRecord', 'Data1', null, {A: 100, B: 1, C: 40, D: 300}],
        ['AddRecord', 'Data1', null, {A: 200, B: 2, C: 45, D: 200}],
        ['AddRecord', 'Data1', null, {A: 300, B: 3, C: 50, D: 100}],

        ['AddRecord', '_grist_ACLResources', -1, {tableId: 'Data1', colIds: 'C,D'}],
        ['AddRecord', '_grist_ACLResources', -2, {tableId: 'Data1', colIds: 'B'}],
        ['AddRecord', '_grist_ACLResources', -3, {tableId: 'Data1', colIds: '*'}],
        ['AddRecord', '_grist_ACLRules', null, {
          resource: -1, aclFormula: 'user.Access != "owners" and rec.A < 200', permissionsText: '-R',
        }],
        ['AddRecord', '_grist_ACLRules', null, {
          resource: -2, aclFormula: 'user.Access != "owners" and rec.A < 50', permissionsText: '-R',
        }],
        ['AddRecord', '_grist_ACLRules', null, {
          resource: -3, aclFormula: 'user.Access != "owners" and rec.B == 99', permissionsText: '-R',
        }],
      ]);
      await reopenClients({first});

      // Make a series of adds/updates, and make sure cells that are affected indirectly
      // are censored or uncensored as appropriate.
      cliEditor.flush();
      cliOwner.flush();
      await owner.getDocAPI(docId).addRows('Data1', {A: [300, 150], B: [1, 1], C: [1, 1], D: [1, 1]});
      assert.deepEqual(await cliEditor.readDocUserAction(),
                       [ [ 'BulkAddRecord',
                           'Data1',
                           [4, 5],
                           { A: [300, 150], manualSort: [4, 5], B: [1, 1],
                             C: [1, [GristObjCode.Censored]],
                             D: [1, [GristObjCode.Censored]] } ] ]);
      assert.deepEqual(await cliOwner.readDocUserAction(),
                       [ [ 'BulkAddRecord',
                           'Data1',
                           [4, 5],
                           { A: [300, 150], manualSort: [4, 5], B: [1, 1], C: [1, 1], D: [1, 1] } ] ]);
      cliEditor.flush();
      cliOwner.flush();
      await owner.getDocAPI(docId).updateRows('Data1', {id: [4], A: [100]});
      assert.deepEqual(await cliEditor.readDocUserAction(),
                       [ [ 'UpdateRecord', 'Data1', 4, { A: 100 } ],
                         [ 'BulkUpdateRecord', 'Data1', [ 4 ], { C: [ [GristObjCode.Censored] ] } ],
                         [ 'BulkUpdateRecord', 'Data1', [ 4 ], { D: [ [GristObjCode.Censored] ] } ] ]);
      assert.deepEqual(await cliOwner.readDocUserAction(),
                       [ [ 'UpdateRecord', 'Data1', 4, { A: 100 } ] ]);
      cliEditor.flush();
      cliOwner.flush();
      await owner.getDocAPI(docId).updateRows('Data1', {id: [4], A: [600]});
      assert.deepEqual(await cliEditor.readDocUserAction(),
                       [ [ 'UpdateRecord', 'Data1', 4, { A: 600 } ],
                         [ 'BulkUpdateRecord', 'Data1', [ 4 ], { C: [ 1 ] } ],
                         [ 'BulkUpdateRecord', 'Data1', [ 4 ], { D: [ 1 ] } ] ]);
      assert.deepEqual(await cliOwner.readDocUserAction(),
                       [ [ 'UpdateRecord', 'Data1', 4, { A:600 } ] ]);
      cliEditor.flush();
      cliOwner.flush();
      await owner.getDocAPI(docId).updateRows('Data1', {id: [4], A: [3]});
      assert.deepEqual(await cliEditor.readDocUserAction(),
                       [ [ 'UpdateRecord', 'Data1', 4, { A: 3 } ],
                         [ 'BulkUpdateRecord', 'Data1', [ 4 ], { B: [ [GristObjCode.Censored] ] } ],
                         [ 'BulkUpdateRecord', 'Data1', [ 4 ], { C: [ [GristObjCode.Censored] ] } ],
                         [ 'BulkUpdateRecord', 'Data1', [ 4 ], { D: [ [GristObjCode.Censored] ] } ] ]);
      assert.deepEqual(await cliOwner.readDocUserAction(),
                       [ [ 'UpdateRecord', 'Data1', 4, { A: 3 } ] ]);
      cliEditor.flush();
      cliOwner.flush();
      await owner.getDocAPI(docId).updateRows('Data1', {id: [4], A: [75]});
      assert.deepEqual(await cliEditor.readDocUserAction(),
                       [ [ 'UpdateRecord', 'Data1', 4, { A: 75 } ],
                         [ 'BulkUpdateRecord', 'Data1', [ 4 ], { B: [ 1 ] } ] ]);
      assert.deepEqual(await cliOwner.readDocUserAction(),
                       [ [ 'UpdateRecord', 'Data1', 4, { A: 75 } ] ]);
      cliEditor.flush();
      cliOwner.flush();
      await owner.getDocAPI(docId).updateRows('Data1', {id: [4], B: [99]});
      assert.deepEqual(await cliEditor.readDocUserAction(),
                       [ [ 'BulkRemoveRecord', 'Data1', [ 4 ] ] ]);
      assert.deepEqual(await cliOwner.readDocUserAction(),
                       [ [ 'UpdateRecord', 'Data1', 4, { B: 99 } ] ]);
      cliEditor.flush();
      cliOwner.flush();
      await owner.getDocAPI(docId).updateRows('Data1', {id: [4], B: [98]});
      assert.deepEqual(await cliEditor.readDocUserAction(),
                       [ [ 'BulkAddRecord',
                           'Data1',
                           [ 4 ],
                           { manualSort: [ 4 ],
                             A: [ 75 ],
                             B: [ 98 ],
                             C: [ [GristObjCode.Censored] ],
                             D: [ [GristObjCode.Censored] ] } ] ]);
      assert.deepEqual(await cliOwner.readDocUserAction(),
                       [ [ 'UpdateRecord', 'Data1', 4, { B: 98 } ] ]);
      cliEditor.flush();
      cliOwner.flush();
      await owner.getDocAPI(docId).updateRows('Data1', {id: [1, 2, 4], A: [1, 75, 200]});
      assert.deepEqual(await cliEditor.readDocUserAction(),
                       [ [ 'BulkUpdateRecord',
                           'Data1',
                           [ 1, 2, 4 ],
                           { A: [ 1, 75, 200 ] } ],
                         [ 'BulkUpdateRecord', 'Data1', [ 1 ], { B: [ [GristObjCode.Censored] ] } ],
                         [ 'BulkUpdateRecord',
                           'Data1',
                           [ 2, 4 ],
                           { C: [ [GristObjCode.Censored], 1 ] } ],
                         [ 'BulkUpdateRecord',
                           'Data1',
                           [ 2, 4 ],
                           { D: [ [GristObjCode.Censored], 1 ] } ] ]);
      assert.deepEqual(await cliOwner.readDocUserAction(),
                       [ [ 'BulkUpdateRecord',
                           'Data1',
                           [ 1, 2, 4 ],
                           { A: [ 1, 75, 200 ] } ] ]);

      // Add a formula column to simulate a reported bug (not actually needed to tickle problem)
      // where a censored cell for one user could show up as censored for another.
      await owner.applyUserActions(docId, [
        ['AddColumn', 'Data1', 'E', {formula: '$C'}],
        ['AddRecord', '_grist_ACLResources', -1, {tableId: 'Data1', colIds: 'E'}],
        ['AddRecord', '_grist_ACLRules', null, {
          resource: -1, aclFormula: 'user.Access != "owners" and rec.A < 200', permissionsText: '-R',
        }],
      ]);
      cliEditor.flush();
      cliOwner.flush();

      await editor.getDocAPI(docId).updateRows('Data1', {id: [2], C: [999]});
      assert.deepEqual(await cliEditor.readDocUserAction(),
                       [ [ 'UpdateRecord', 'Data1', 2, { C: [GristObjCode.Censored] } ],
                         [ 'UpdateRecord', 'Data1', 2, { E: [GristObjCode.Censored] } ] ]);
      assert.deepEqual(await cliOwner.readDocUserAction(),
                       [ [ 'UpdateRecord', 'Data1', 2, { C: 999 } ],
                         [ 'UpdateRecord', 'Data1', 2, { E: 999 } ] ]);

      // Check that only the owner can evaluate the formula.
      let response = await cliOwner.send('getFormulaError', 0, 'Data1', 'E', 2);
      assert.equal(response.data, 999);
      response = await cliEditor.send('getFormulaError', 0, 'Data1', 'E', 2);
      assert.equal(response.data, undefined);
      assert.equal(response.error, 'Cannot access cell');
      assert.equal(response.errorCode, 'ACL_DENY');
    });
  }

  it('respects BROADCAST_TIMEOUT_MS', async function() {
    await freshDoc();
    await owner.applyUserActions(docId, [
      ['AddTable', 'Data1', [{id: 'A', type: 'Numeric'},
                             {id: 'B', type: 'Numeric'}]]
    ]);

    // Set timeout negative, so broadcasts fail reliably, and see
    // that connections close.
    const timeoutStub = sandbox.stub(DocClientsDeps, 'BROADCAST_TIMEOUT_MS').value(-1);
    try {
      cliEditor.flush();
      cliOwner.flush();
      assert.equal(cliEditor.isOpen(), true);
      assert.equal(cliOwner.isOpen(), true);
      await owner.getDocAPI(docId).addRows('Data1', {A: [300, 150], B: [1, 1]});
      await delay(100);
      assert.equal(cliEditor.isOpen(), false);
      assert.equal(cliOwner.isOpen(), false);
    } finally {
      timeoutStub.restore();
    }
  });

  describe('filterColValues', async function() {
    // A method for checking if a cell contains 'x'.
    function xRemove(val: any) { return val === 'x'; }

    for (const actType of ['BulkUpdateRecord', 'BulkAddRecord', 'ReplaceTableData', 'TableData'] as const) {
      it(`should remove correct elements for ${actType}`, function() {
        // Prepare a 1 row bulk action.
        const action1: BulkUpdateRecord|BulkAddRecord|ReplaceTableData|TableDataAction = [
          actType,
          'Table1',
          [1],
          {
            a: ['x'], b: ['b'], c: ['x']
          }
        ];
        // Check the action is unchanged if row is not specified for filtering.
        assert.deepEqual(filterColValues(cloneDeep(action1), (idx) => idx === 99, xRemove),
                         [action1]);
        // Check the action is filtered as expected if row is specified.  Action set returned
        // is suboptimal, but nevertheless as expected.
        assert.deepEqual(filterColValues(cloneDeep(action1), (idx) => idx === 0, xRemove),
                         [[actType, 'Table1', [], {a: [], b: [], c: []}],
                          [actType, 'Table1', [1], {b: ['b']}]]);
        // Prepare a multi-row bulk action.
        const action2: typeof action1 = [
          actType,
          'Table1',
          [1, 2, 3],
          {
            a: ['x', 'a', 'a'], b: ['b', 'b', 'b'], c: ['x', 'c', 'x']
          }
        ];
        // Check filtering is as expected: one retained row, two new actions for the
        // two new permutations of columns.
        assert.deepEqual(filterColValues(cloneDeep(action2), (idx) => idx % 2 === 0, xRemove),
                         [[actType, 'Table1', [2], {a: ['a'], b: ['b'], c: ['c']}],
                          [actType, 'Table1', [3], {a: ['a'], b: ['b']}],
                          [actType, 'Table1', [1], {b: ['b']}]]);
        // Prepare a many-row bulk action, and check filtering is as expected.
        const action3: typeof action1 = [
          actType,
          'Table1',
          [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
          {
            a: ['a', 'a', 'a', 'a', 'x', 'x', 'x', 'x', 'A', 'A', 'A', 'A'],
            b: ['b', 'b', 'x', 'x', 'b', 'b', 'x', 'x', 'B', 'B', 'x', 'x'],
            c: ['c', 'x', 'c', 'x', 'c', 'x', 'c', 'x', 'C', 'x', 'C', 'x'],
          }
        ];
        assert.deepEqual(filterColValues(cloneDeep(action3), (idx) => ![0, 8].includes(idx), xRemove),
                         [[actType, 'Table1', [1, 9], {a: ['a', 'A'], b: ['b', 'B'], c: ['c', 'C']}],
                          [actType, 'Table1', [8], {}],
                          [actType, 'Table1', [4, 12], {a: ['a', 'A']}],
                          [actType, 'Table1', [2, 10], {a: ['a', 'A'], b: ['b', 'B']}],
                          [actType, 'Table1', [3, 11], {a: ['a', 'A'], c: ['c', 'C']}],
                          [actType, 'Table1', [6], {b: ['b']}],
                          [actType, 'Table1', [5], {b: ['b'], c: ['c']}],
                          [actType, 'Table1', [7], {c: ['c']}]]);
      });
    }

    for (const actType of ['UpdateRecord', 'AddRecord'] as const) {
      it(`should remove correct elements for ${actType}`, function() {
        const action1: UpdateRecord|AddRecord = [
          actType,
          'Table1',
          1,
          {
            a: 'x', b: 'b', c: 'x'
          }
        ];
        assert.deepEqual(filterColValues(cloneDeep(action1), (idx) => idx === 0, xRemove),
                         [[actType, 'Table1', 1, {b: 'b'}]]);
        // shouldFilterRow is somewhat arbitrarily ignored for non-bulk changes.
        assert.deepEqual(filterColValues(cloneDeep(action1), (idx) => idx === 99, xRemove),
                         [[actType, 'Table1', 1, {b: 'b'}]]);
      });
    }

    it('should not remove anything for BulkRemoveRecord', function() {
      const action1: BulkRemoveRecord = ['BulkRemoveRecord', 'Table1', [1, 2, 3]];
      assert.deepEqual(filterColValues(cloneDeep(action1), (idx) => idx === 0, xRemove), [action1]);
    });

    it('should not remove anything for RemoveRecord', function() {
      const action1: RemoveRecord = ['RemoveRecord', 'Table1', 1];
      assert.deepEqual(filterColValues(cloneDeep(action1), (idx) => idx === 0, xRemove), [action1]);
    });
  });

  it('respects exceptional sessions for reading', async function() {
    const activeDoc = await docTools.createDoc('test-doc');
    // Make an exceptional session with full unconditional access.
    const systemSession = makeExceptionalDocSession('system');
    // Make a fake regular session with access-rule-dependent access.
    const userSession = docSessionFromRequest({
      docAuth: {access: 'viewers'},
      userId: 1,
      fullUser: {id: 1, email: 'someone@getgrist.com', name: ''},
      get: () => undefined,
    } as any);
    // Deny everyone access to Table1, and a column and row of Table2.
    await activeDoc.applyUserActions(systemSession, [
      ['AddTable', 'Table1', [{id: 'A'}, {id: 'B'}]],
      ['AddRecord', 'Table1', null, {A: 2021, B: 'kangaroo'}],
      ['AddTable', 'Table2', [{id: 'A'}, {id: 'B'}]],
      ['AddRecord', 'Table2', null, {A: 2022, B: 'wallaby'}],
      ['AddRecord', 'Table2', null, {A: -1, B: 'koala'}],
      ['AddRecord', '_grist_ACLResources', -1, {tableId: 'Table1', colIds: '*'}],
      ['AddRecord', '_grist_ACLResources', -2, {tableId: 'Table2', colIds: 'B'}],
      ['AddRecord', '_grist_ACLResources', -3, {tableId: 'Table2', colIds: '*'}],
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -1, aclFormula: 'True', permissionsText: 'none',
      }],
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -2, aclFormula: 'True', permissionsText: 'none',
      }],
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -3, aclFormula: 'rec.A < 0', permissionsText: 'none',
      }],
    ]);
    // Check that exceptional session has full access to Table1 anyway.
    assert.deepEqual((await activeDoc.fetchTable(systemSession, 'Table1')).tableData,
                     [ 'TableData', 'Table1', [ 1 ],
                       { manualSort: [ 1 ], A: [ '2021' ], B: [ 'kangaroo' ] } ]);
    // Check that regular session does not have access to Table1.
    await assert.isRejected(activeDoc.fetchTable(userSession, 'Table1'),
                            /Blocked by table read access rules/);
    // Check that exceptional session has full access to Table2 anyway.
    assert.deepEqual((await activeDoc.fetchTable(systemSession, 'Table2')).tableData,
                     [ 'TableData', 'Table2', [ 1, 2 ],
                       { manualSort: [ 1, 2 ], A: [ '2022', '-1' ], B: [ 'wallaby', 'koala' ] } ]);
    // Check that regular session does not have full access to Table2.
    assert.deepEqual((await activeDoc.fetchTable(userSession, 'Table2')).tableData,
                     [ 'TableData', 'Table2', [ 1 ],
                       { manualSort: [ 1 ], A: [ '2022' ] } ]);
  });

  for (const flags of ['-R', '-RS']) {
    it(`can receive metadata updates even if there is a default ${flags} rule`, async function() {
    await freshDoc();
      // Make a document with a default rule forbidding editor from reading anything.
      await owner.applyUserActions(docId, [
        ['AddTable', 'Private', [{id: 'A'}]],
        ['AddRecord', '_grist_ACLResources', -1, {tableId: '*', colIds: '*'}],
        ['AddRecord', '_grist_ACLRules', null, {
          resource: -1, aclFormula: `user.Access != OWNER`, permissionsText: flags,
        }],
      ]);

      // Add an extra table, and capture the update sent to the editor.
      cliEditor.flush();
      await owner.applyUserActions(docId, [
        ['AddTable', 'Private2', [{id: 'A'}]],
      ]);
      const msg = await cliEditor.readMessage();

      // Make sure we saw something.
      assert.isAbove(msg?.data?.docActions.length, 10);
      // Make sure everything we saw was metadata, and the Private2 AddTable
      // action itself did not slip through.
      assert.equal((msg?.data?.docActions as Array<DocAction>)
                     .every(a => a[1].startsWith('_grist')), true);
    });
  }

  it('can enumerate and use "View As" users', async function() {
    await freshDoc();

    // Check that "View As" users cover users the document is shared with, and
    // example users.
    cliOwner.flush();
    let perm: PermissionDataWithExtraUsers = (await cliOwner.send("getUsersForViewAs", 0)).data;
    const getId = (name: string) => home.dbManager.testGetId(name) as Promise<number>;
    const getRef = (email: string) => home.dbManager.getUserByLogin(email).then(user => user.ref);
    assert.deepEqual(perm.users, [
      { id: await getId('Chimpy'), email: 'chimpy@getgrist.com', name: 'Chimpy',
        ref: await getRef('chimpy@getgrist.com'),
        picture: null, access: 'owners', isMember: true, disabledAt: null },
      { id: await getId('Kiwi'), email: 'kiwi@getgrist.com', name: 'Kiwi',
        ref: await getRef('kiwi@getgrist.com'),
        picture: null, access: 'owners', isMember: false, disabledAt: null },
      { id: await getId('Charon'), email: 'charon@getgrist.com', name: 'Charon',
        ref: await getRef('charon@getgrist.com'),
        picture: null, access: 'editors', isMember: false, disabledAt: null },
    ]);
    assert.deepEqual(perm.attributeTableUsers, []);
    assert.deepEqual(perm.exampleUsers[0],
                     { id: 0, email: 'owner@example.com', name: 'Owner', access: 'owners' });

    // Add a user attribute table mentioning some users the doc is shared with and
    // some novel users.
    await owner.applyUserActions(docId, [
      ['AddTable', 'Leads', [{id: 'Name'}, {id: 'Place'}]],
      ['AddRecord', 'Leads', null, {Name: 'Yi Wen', Place: 'Seattle'}],
      ['AddRecord', 'Leads', null, {Name: 'Zeng Hua', Place: 'Boston'}],
      ['AddRecord', 'Leads', null, {Name: 'Tao Ping', Place: 'Cambridge'}],
      ['AddTable', 'Zones', [{id: 'Email'}, {id: 'City'}]],
      ['AddRecord', 'Zones', null, {Email: 'chimpy@getgrist.com', City: 'Seattle'}],
      ['AddRecord', 'Zones', null, {Email: 'charon@getgrist.com', City: 'Boston'}],
      ['AddRecord', 'Zones', null, {Email: 'fast@speed.com', City: 'Cambridge'}],
      ['AddRecord', 'Zones', null, {Email: 'slow@speed.com', City: 'Springfield'}],
      ['AddRecord', '_grist_ACLResources', -1, {tableId: '*', colIds: '*'}],
      ['AddRecord', '_grist_ACLResources', -2, {tableId: 'Leads', colIds: '*'}],
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -1, userAttributes: JSON.stringify({
          name: 'Zone',
          tableId: 'Zones',
          charId: 'Email',
          lookupColId: 'Email',
        }),
      }],
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -2, aclFormula: 'user.Zone.City and user.Zone.City != rec.Place', permissionsText: 'none',
      }],
    ]);

    // Check that "View As" users now in addition have the novel user attribute table
    // users.
    cliOwner.flush();
    perm = (await cliOwner.send("getUsersForViewAs", 0)).data;
    assert.deepEqual(perm.users, [
      { id: await getId('Chimpy'), email: 'chimpy@getgrist.com', name: 'Chimpy',
        ref: await getRef('chimpy@getgrist.com'),
        picture: null, access: 'owners', isMember: true, disabledAt: null },
      { id: await getId('Kiwi'), email: 'kiwi@getgrist.com', name: 'Kiwi',
        ref: await getRef('kiwi@getgrist.com'),
        picture: null, access: 'owners', isMember: false, disabledAt: null },
      { id: await getId('Charon'), email: 'charon@getgrist.com', name: 'Charon',
        ref: await getRef('charon@getgrist.com'),
        picture: null, access: 'editors', isMember: false, disabledAt: null },
    ]);
    assert.deepEqual(perm.attributeTableUsers, [
      { id: 0, email: 'fast@speed.com', name: 'fast', access: 'editors' },
      { id: 0, email: 'slow@speed.com', name: 'slow', access: 'editors' },
    ]);
    assert.deepEqual(perm.exampleUsers[0],
                     { id: 0, email: 'owner@example.com', name: 'Owner', access: 'owners' });

    // Add a second user attribute table, this time also with names and access levels.
    await owner.applyUserActions(docId, [
      ['AddTable', 'Users', [{id: 'Email2'}, {id: 'Name'}, {id: 'Access'}]],
      ['AddRecord', 'Users', null, {Email2: 'red@color.com', Name: 'Rita', Access: 'owners'}],
      ['AddRecord', 'Users', null, {Email2: 'green@color.com', Name: 'Gary', Access: 'editors'}],
      ['AddRecord', 'Users', null, {Email2: 'blue@color.com', Name: 'Beatrix', Access: 'viewers'}],
      ['AddRecord', 'Users', null, {Email2: 'yellow@color.com', Name: 'Yan', Access: null}],
      ['AddRecord', '_grist_ACLRules', null, {
        resource: 2, userAttributes: JSON.stringify({
          name: 'More',
          tableId: 'Users',
          charId: 'Email',
          lookupColId: 'Email2',
        })
      }],
    ]);

    // Check the new users get added as "View As" options.
    cliOwner.flush();
    perm = (await cliOwner.send("getUsersForViewAs", 0)).data;
    assert.deepEqual(perm.attributeTableUsers, [
      { id: 0, email: 'fast@speed.com', name: 'fast', access: 'editors' },
      { id: 0, email: 'slow@speed.com', name: 'slow', access: 'editors' },
      { id: 0, email: 'red@color.com', name: 'Rita', access: 'owners' },
      { id: 0, email: 'green@color.com', name: 'Gary', access: 'editors' },
      { id: 0, email: 'blue@color.com', name: 'Beatrix', access: 'viewers' },
      { id: 0, email: 'yellow@color.com', name: 'Yan', access: null },
    ]);

    // Check that doing a "View As" as a user from the first user attribute table works
    // as expected (the user is an editor, and has the expected user attributes in rules).
    await reopenClients({linkParameters: {aclAsUser: 'fast@speed.com'}});
    cliOwner.flush();
    assert.deepEqual((await cliOwner.send('fetchTable', 0, 'Leads')).data.tableData,
                     [ 'TableData', 'Leads', [ 3 ],
                       { manualSort: [ 3 ], Place: [ 'Cambridge' ], Name: [ 'Tao Ping' ] } ]);
    let res = await cliOwner.send("applyUserActions", 0, [
      ["UpdateRecord", "Leads", 3, { Name: "Tao" }],
    ]);
    assert.hasAllKeys(res.data, [
      "actionNum",
      "actionHash",
      "retValues",
      "isModification",
    ]);
    assert.deepEqual(
      pick(res.data, "actionNum", "retValues", "isModification"),
      {
        actionNum: 4,
        retValues: [null],
        isModification: true,
      }
    );
    assert.match((await cliOwner.send('applyUserActions', 0,
                                     [['UpdateRecord', 'Leads', 2, {Name: 'Zao'}]])).error!,
                 /Blocked by row update access rules/);

    // Check that doing a "View As" as a user from the second user attribute table works
    // as expected (the user has the specified access level, "viewers" in this case).
    await reopenClients({linkParameters: {aclAsUser: 'blue@color.com'}});
    cliOwner.flush();
    assert.deepEqual((await cliOwner.send('fetchTable', 0, 'Leads')).data.tableData,
                     [ 'TableData', 'Leads', [ 1, 2, 3 ],
                       { manualSort: [ 1, 2, 3 ],
                         Place: [ 'Seattle', 'Boston', 'Cambridge' ],
                         Name: [ 'Yi Wen', 'Zeng Hua', 'Tao' ] } ]);
    assert.match((await cliOwner.send('applyUserActions', 0,
                                      [['UpdateRecord', 'Leads', 2, {Name: 'Zao'}]])).error!,
                 /Blocked by table update access rules/);

    // Check that doing a "View As" as a dummy user works as expected.
    await reopenClients({linkParameters: {aclAsUser: 'viewer@example.com'}});
    cliOwner.flush();
    assert.match((await cliOwner.send('applyUserActions', 0,
                                      [['UpdateRecord', 'Leads', 2, {Name: 'Zao'}]])).error!,
                 /Blocked by table update access rules/);
    await reopenClients({linkParameters: {aclAsUser: 'owner@example.com'}});
    cliOwner.flush();
    res = await cliOwner.send("applyUserActions", 0, [
      ["UpdateRecord", "Leads", 2, { Name: "Zao" }],
    ]);
    assert.hasAllKeys(res.data, [
      "actionNum",
      "actionHash",
      "retValues",
      "isModification",
    ]);
    assert.deepEqual(
      pick(res.data, "actionNum", "retValues", "isModification"),
      {
        actionNum: 5,
        retValues: [null],
        isModification: true,
      }
    );
    await reopenClients({linkParameters: {aclAsUser: 'unknown@example.com'}});
    cliOwner.flush();
    assert.match((await cliOwner.send('applyUserActions', 0,
                                     [['UpdateRecord', 'Leads', 2, {Name: 'Gao'}]])).error!,
                 /Blocked by table update access rules/);
    assert.match((await cliOwner.send('fetchTable', 0, 'Leads')).error!,
                 /Blocked by table read access rules/);

    // Check that doing a "View As" a user the doc is shared with works as expected.
    await reopenClients({linkParameters: {aclAsUser: 'charon@getgrist.com'}});
    cliOwner.flush();
    assert.deepEqual((await cliOwner.send('fetchTable', 0, 'Leads')).data.tableData,
                     [ 'TableData', 'Leads', [ 2 ],
                       { manualSort: [ 2 ], Place: [ 'Boston' ], Name: [ 'Zao' ] } ]);

    // Check that doing a "View As" an unknown user works reasonably
    await reopenClients({linkParameters: {aclAsUser: 'mystery@getgrist.com'}});
    cliOwner.flush();
    assert.match((await cliOwner.send('fetchTable', 0, 'Leads')).error!,
                 /Blocked by table read access rules/);
  });

  it('controls read and write access to attachment content', async function() {
    await freshDoc();

    // Make a table, with attachments, and with non-owners missing access to a row.
    await owner.applyUserActions(docId, [
      ['AddTable', 'Data1', [{id: 'A'},
                             {id: 'B'},
                             {id: 'Texts', type: 'Attachments'},
                             {id: 'Public', isFormula: true, formula: '$B == "clear"'}]],
      ['AddRecord', 'Data1', null, {A: 'near', B: 'clear'}],
      ['AddRecord', 'Data1', null, {A: 'far', B: 'notclear'}],
      ['AddRecord', 'Data1', null, {A: 'in a motor car', B: 'clear'}],
      ['AddRecord', '_grist_ACLResources', -1, {tableId: 'Data1', colIds: '*'}],
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -1, aclFormula: 'user.Access != OWNER and not rec.Public', permissionsText: 'none',
      }],
    ]);

    // Add some attachments.
    const i1 = await owner.getDocAPI(docId).uploadAttachment('content1', '1.txt');
    const i2 = await owner.getDocAPI(docId).uploadAttachment('content2', '2.txt');
    const i3 = await owner.getDocAPI(docId).uploadAttachment('content3', '3.txt');
    const i4 = await owner.getDocAPI(docId).uploadAttachment('content4', '4.txt');
    await owner.getDocAPI(docId).updateRows('Data1', {id: [1], Texts: [[GristObjCode.List, i1, i2]]});
    await owner.getDocAPI(docId).updateRows('Data1', {id: [2], Texts: [[GristObjCode.List, i3]]});
    await owner.getDocAPI(docId).updateRows('Data1', {id: [3], Texts: [[GristObjCode.List, i4]]});

     // Share the document with everyone as an editor.
    await owner.updateDocPermissions(docId, { users: { 'everyone@getgrist.com': 'editors' } });

    // Check an editor can only access the attachments we expect.
    assert.equal(await getAttachment(editor, docId, i1), 'content1');
    assert.equal(await getAttachment(editor, docId, i2), 'content2');
    await assert.isRejected(getAttachment(editor, docId, i3), /403.*Cannot access attachment/);
    assert.equal(await getAttachment(editor, docId, i4), 'content4');

    // Add another table with an attachment column, leaving access open.
    await owner.applyUserActions(docId, [
      ['AddTable', 'Data2', [{id: 'MoreTexts', type: 'Attachments'},
                             {id: 'Unrelated', type: 'RefList:Data2'}]],
      ['AddRecord', 'Data2', null, {}],
    ]);

    // Check that user can't gain access to an attachment by writing its id into a cell.
    await assert.isRejected(getAttachment(editor, docId, i3), /403.*Cannot access attachment/);
    await assert.isRejected(editor.getDocAPI(docId).updateRows(
      'Data2',
      {id: [1], MoreTexts: [[GristObjCode.List, i3]]}
    ), /403.*Cannot access attachment/);
    // Don't allow even sticking in an id in an unexpected format.
    await assert.isRejected(editor.getDocAPI(docId).updateRows(
      'Data2',
      {id: [1], MoreTexts: [i3]}
    ), /403.*Cannot access attachment/);
    await assert.isRejected(editor.getDocAPI(docId).updateRows(
      'Data2',
      {id: [1], MoreTexts: [[GristObjCode.List, i2, i3]]}
    ), /403.*Cannot access attachment/);
    await assert.isFulfilled(editor.getDocAPI(docId).updateRows(
      'Data2',
      {id: [1], MoreTexts: [[GristObjCode.List, i2]]}
    ));

    // Check no confusion between columns.
    await assert.isFulfilled(editor.getDocAPI(docId).updateRows(
      'Data2',
      {id: [1], MoreTexts: [[GristObjCode.List, i1]], Unrelated: [[GristObjCode.List, i3]]}
    ));
    await assert.isRejected(editor.getDocAPI(docId).updateRows(
      'Data2',
      {id: [1], MoreTexts: [[GristObjCode.List, i3]], Unrelated: [[GristObjCode.List, i2]]}
    ), /403.*Cannot access attachment/);

    // Check that user can add attachments they just uploaded.
    const i5 = await editor.getDocAPI(docId).uploadAttachment('content5', '5.txt');
    await assert.isFulfilled(editor.getDocAPI(docId).updateRows(
      'Data2',
      {id: [1], MoreTexts: [[GristObjCode.List, i5]]}
    ));

    // Check that non-owner cannot add attachments uploaded by someone else.
    const i6 = await owner.getDocAPI(docId).uploadAttachment('content6', '6.txt');
    await assert.isRejected(editor.getDocAPI(docId).updateRows(
      'Data2',
      {id: [1], MoreTexts: [[GristObjCode.List, i6]]}
    ), /403.*Cannot access attachment/);

    // Attachment check is not applied for undos of actions by the same user.
    const ownerProfile = await owner.getUserProfile();
    const editorProfile = await editor.getUserProfile();
    const ownerInfo = {
      user: ownerProfile.email,
      time: Date.now(),
    };
    const editorInfo = {
      user: editorProfile.email,
      time: Date.now(),
    };
    // Owner mismatch case.
    assert.match((await applyAsUndo(cliEditor, [['UpdateRecord', 'Data2', 1, {MoreTexts: [GristObjCode.List, i6]}]],
                                    ownerInfo))?.error || '',
                 /Cannot access attachment/);
    // Old action case.
    assert.match((await applyAsUndo(cliEditor, [['UpdateRecord', 'Data2', 1, {MoreTexts: [GristObjCode.List, i6]}]],
                                    {...editorInfo, time: editorInfo.time - 48 * 60 * 60 * 1000}))?.error || '',
                 /Cannot access attachment/);
    // Good case.
    assert.equal((await applyAsUndo(cliEditor, [['UpdateRecord', 'Data2', 1, {MoreTexts: [GristObjCode.List, i6]}]],
                                    editorInfo))?.error || '', '');

    // Check that adding an attachment to a cell a user has access to
    // will grant them access to the attachment's contents.
    await assert.isRejected(getAttachment(editor, docId, i3), /403.*Cannot access attachment/);
    await owner.getDocAPI(docId).updateRows('Data2', {id: [1], MoreTexts: [[GristObjCode.List, i3]]});
    assert.equal(await getAttachment(editor, docId, i3), 'content3');
  });

  it('can add attachments when there are row-level rules', async function() {
    await freshDoc();

    // Make a table, with attachments, and with row-level edit rights.
    await owner.applyUserActions(docId, [
      ['AddTable', 'Data1', [{id: 'A'},
                             {id: 'Texts', type: 'Attachments'}]],
      ['AddRecord', 'Data1', null, {A: 'edit'}],
      ['AddRecord', 'Data1', null, {A: 'read'}],
      ['AddRecord', 'Data1', null, {A: ''}],
      ['AddRecord', '_grist_ACLResources', -1, {tableId: '*', colIds: '*'}],
      ['AddRecord', '_grist_ACLResources', -2, {tableId: 'Data1', colIds: '*'}],
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -1, aclFormula: 'user.Access != OWNER', permissionsText: 'none',
      }],
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -2, aclFormula: 'user.Access == OWNER', permissionsText: '+RUCD',
      }],
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -2, aclFormula: '$A == "edit"', permissionsText: '+RUCD',
      }],
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -2, aclFormula: '$A == "read"', permissionsText: '+R-UCD',
      }],
    ]);

    // Share the document with everyone as an editor.
    await owner.updateDocPermissions(docId, { users: { 'everyone@getgrist.com': 'editors' } });

    let attachments = cliOwner.getMetaRecords('_grist_Attachments');
    assert.lengthOf(attachments, 0);

    // Add an attachment as an owner.
    const i1 = await owner.getDocAPI(docId).uploadAttachment('content1', '1.txt');
    await owner.getDocAPI(docId).updateRows('Data1', {id: [1],
                                                      Texts: [[GristObjCode.List, i1]]});

    await cliOwner.waitForServer();
    await cliEditor.waitForServer();
    attachments = cliOwner.getMetaRecords('_grist_Attachments');
    assert.lengthOf(attachments, 1);
    attachments = cliEditor.getMetaRecords('_grist_Attachments');
    assert.lengthOf(attachments, 1);  // record is visible to everyone because A is 'edit'

    // Check an editor can add an attachment on an allowed row. Check that
    // when doing so, the editor receives attachment metadata along with the
    // attachment cell change.
    cliEditor.flush();
    cliOwner.flush();
    const i2 = await editor.getDocAPI(docId).uploadAttachment('content2', '2.txt');
    // Owner should see attachment info already (no filtering for them).
    let msg = await cliOwner.readMessage();
    let gristAttachmentAction: any[] = msg.data.docActions[0];
    assert.deepEqual(gristAttachmentAction.slice(0, 3),
                     ['AddRecord', '_grist_Attachments', 2]);
    await cliOwner.waitForServer();
    await cliEditor.waitForServer();
    attachments = cliOwner.getMetaRecords('_grist_Attachments');
    assert.lengthOf(attachments, 2);
    // Editor should not (need to wait until attachment is "in" a cell they can access).
    attachments = cliEditor.getMetaRecords('_grist_Attachments');
    assert.lengthOf(attachments, 1);

    cliEditor.flush();
    // Add the attachment in a cell. Editor should receive metadata at this point.
    await editor.getDocAPI(docId).updateRows('Data1', {id: [1], Texts: [[GristObjCode.List, i1, i2]]});
    msg = await cliEditor.readMessage();
    gristAttachmentAction = msg.data.docActions[0];
    const gristCellAction: any[] = msg.data.docActions[1];
    assert.deepEqual(gristAttachmentAction.slice(0, 3),
                     ['BulkAddRecord', '_grist_Attachments', [1, 2]]);
    assert.deepEqual(gristCellAction.slice(0, 3),
                     ['UpdateRecord', 'Data1', 1]);
    await cliEditor.waitForServer();
    attachments = cliEditor.getMetaRecords('_grist_Attachments');
    assert.lengthOf(attachments, 2);

    // Check an editor cannot add an attachment on a forbidden row.
    await assert.isRejected(editor.getDocAPI(docId).updateRows('Data1', {id: [2], Texts: [[GristObjCode.List, i2]]}),
                            /Blocked by row update access rules/);

    // Check if an attachment is added to a cell the editor cannot read, they aren't
    // told about it.
    const i3 = await owner.getDocAPI(docId).uploadAttachment('content3', '3.txt');
    await owner.getDocAPI(docId).updateRows('Data1', {id: [3], Texts: [[GristObjCode.List, i3]]});
    await cliOwner.waitForServer();
    await cliEditor.waitForServer();
    attachments = cliOwner.getMetaRecords('_grist_Attachments');
    assert.lengthOf(attachments, 3);
    attachments = cliEditor.getMetaRecords('_grist_Attachments');
    assert.lengthOf(attachments, 2);
    // Now tell them.
    await owner.getDocAPI(docId).updateRows('Data1', {id: [3], A: ['read']});
    msg = await cliEditor.readMessage();
    gristAttachmentAction = msg.data.docActions[0];
    assert.deepEqual(gristAttachmentAction.slice(0, 3),
                     ['BulkAddRecord', '_grist_Attachments', [3]]);
    await cliEditor.waitForServer();
    attachments = cliEditor.getMetaRecords('_grist_Attachments');
    assert.lengthOf(attachments, 3);
  });

  it('has access to user reference variable', async function() {
    await freshDoc();
    await owner.applyUserActions(docId, [
      ['AddTable', 'Data', [{id: 'A'}]],
    ]);

    // Test that ACL rules works as usual.
    await assert.isFulfilled(owner.applyUserActions(docId, [['AddRecord', 'Data', null, {}]]));
    await assert.isFulfilled(editor.applyUserActions(docId, [['AddRecord', 'Data', null, {}]]));
    // Add anonymous user as an editor.
    await owner.updateDocPermissions(docId, { users: { "anon@getgrist.com": 'editors' } });
    const anonym = await openClient(home.server, "anon@getgrist.com", "testy");
    anonym.ignoreTrivialActions();
    await anonym.openDocOnConnect(docId);
    try {
      // Make sure he add record too
      let result = await anonym.send('applyUserActions', 0, [['AddRecord', 'Data', null, {}]]);
      assert.isUndefined(result.errorCode);
      // Now make rule, that he can't using UserRef attribute.
      await owner.applyUserActions(docId, [
        ['AddRecord', '_grist_ACLResources', -1, {tableId: 'Data', colIds: '*'}],
        ['AddRecord', '_grist_ACLRules', null, {
          resource: -1, aclFormula: 'user.UserRef is None', permissionsText: 'none',
        }],
      ]);
      // Test that ACL rules works as usual for logged in user.
      await assert.isFulfilled(owner.applyUserActions(docId, [['AddRecord', 'Data', null, {}]]));
      await assert.isFulfilled(editor.applyUserActions(docId, [['AddRecord', 'Data', null, {}]]));
      // Test our new rule based on UserRef attribute.
      result = await anonym.send('applyUserActions', 0, [['AddRecord', 'Data', null, {}]]);
      assert.equal(result.errorCode, 'ACL_DENY');
    } finally {
      anonym.flush();
      await closeClient(anonym);
    }
  });

  it('cannot modify _grist_Attachments directly when granular access applies', async function() {
    await freshDoc();
    await owner.applyUserActions(docId, [
      ['AddTable', 'Data1', [{id: 'Texts', type: 'Attachments'}]],
      ['AddRecord', '_grist_ACLResources', -1, {tableId: '*', colIds: '*'}],
      // Add a dummy rule that doesn't change anything, just to make sure that
      // granular access rules are processed.
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -1, aclFormula: 'user.Access in [OWNER]', permissionsText: 'all',
      }],
    ]);

    // Add an attachment through regular mechanism.
    const i1 = await owner.getDocAPI(docId).uploadAttachment('content1', '1.txt');
    await owner.getDocAPI(docId).addRows('Data1', {Texts: [[GristObjCode.List, i1]]});

    // Try to modify _grist_Attachments by shady means.
    await assert.isRejected(owner.getDocAPI(docId).addRows('_grist_Attachments', {fileName: ['A', 'B']}),
                            /_grist_Attachments modification is not allowed/);
    await assert.isRejected(owner.getDocAPI(docId).updateRows('_grist_Attachments', {id: [1], fileName: ['A']}),
                            /_grist_Attachments modification is not allowed/);
    await assert.isRejected(owner.getDocAPI(docId).removeRows('_grist_Attachments', [1]),
                            /_grist_Attachments modification is not allowed/);
  });

  describe('shares', function() {

    it('can give table access for a form', async function() {
      await freshDoc();

      // Publish an empty share.
      await owner.applyUserActions(docId, [
        ['AddRecord', '_grist_Shares', null, {
          linkId: 'x',
          options: '{"publish": true}'
        }],
      ]);

      // Check it reached the home db.
      let shares = await home.dbManager.connection.query('select * from shares');
      assert.lengthOf(shares, 1);
      assert.equal(shares[0].link_id, 'x');
      assert.deepEqual(JSON.parse(shares[0].options),
                       { publish: true });
      assert.isAtLeast(shares[0].key.length, 12);

      // Check that user data is not yet available via the share.
      const ham = await home.createHomeApi('ham', 'docs', true);
      const hamShare = ham.getDocAPI(await getShareKeyForUrl('x'));
      await assert.isRejected(hamShare.getRows('Table1'), /Forbidden/);

      // Check that metadata is available but censored.
      let tables = await hamShare.getRows('_grist_Tables');
      assert.lengthOf(tables.id, 1);
      assert.equal(tables.tableId[0], '');

      // Form-share a section.
      await owner.applyUserActions(docId, [
        ['UpdateRecord', '_grist_Views_section', 1,
         {shareOptions: '{"publish": true, "form": true}'}],
        ['UpdateRecord', '_grist_Pages', 1, {shareRef: 1}],
        ['AddRecord', 'Table1', null, {A: 1, B: 1, C: 1}],
      ]);

      // Check the appropriate table is now available.
      tables = await hamShare.getRows('_grist_Tables');
      assert.lengthOf(tables.id, 1);
      assert.equal(tables.tableId[0], 'Table1');

      // Check an empty read is possible. This is a
      // convenience rather than a necessity.
      assert.deepEqual(
        await hamShare.getRows('Table1'),
        { id: [], manualSort: [], A: [], C: [], B: [] }
      );

      // Owner sees all rows.
      assert.deepEqual(
        await owner.getDocAPI(docId).getRows('Table1'),
        { id: [1], manualSort: [1], A: [1], C: [1], B: [1] }
      );

      // Creating a row should be allowed.
      await hamShare.addRows('Table1', { A: [99] });

      // Still don't see anything.
      assert.deepEqual(
        await hamShare.getRows('Table1'),
        { id: [], manualSort: [], A: [], C: [], B: [] }
      );

      // Confirm row is actually there.
      assert.deepEqual(
        await owner.getDocAPI(docId).getRows('Table1'),
        { id: [1, 2], manualSort: [1, 2], A: [1, 99], C: [1, 0], B: [1, 0] }
      );

      // Updates not allowed.
      await assert.isRejected(hamShare.updateRows('Table1', { id: [2], A: [100] }), /Forbidden/);

      // Removals not allowed.
      await assert.isRejected(hamShare.removeRows('Table1', [2]), /Forbidden/);

      // Check both operations work when you have rights.
      await owner.getDocAPI(docId).updateRows('Table1', { id: [2], A: [100] });
      await owner.getDocAPI(docId).removeRows('Table1', [2]);

      // Modify shares options in doc, and see that they propagate.
      await owner.applyUserActions(docId, [
        ['UpdateRecord', '_grist_Shares', 1, {
          options: '{"publish": true, "test": true}'
        }],
      ]);
      shares = await home.dbManager.connection.query('select * from shares');
      assert.lengthOf(shares, 1);
      assert.deepEqual(JSON.parse(shares[0].options),
                       {publish: true, test: true});

      // Unpublish at share level, and make sure data access
      // is now forbidden.
      await owner.applyUserActions(docId, [
        ['UpdateRecord', '_grist_Shares', 1, {
          options: '{"publish": false}'
        }],
      ]);
      await assert.isRejected(hamShare.getRows('Table1'), /Forbidden/);
      await assert.isRejected(hamShare.getRows('_grist_Tables'), /Forbidden/);

      await owner.applyUserActions(docId, [
        ['RemoveRecord', '_grist_Shares', 1]
      ]);
      shares = await home.dbManager.connection.query('select * from shares');
      assert.lengthOf(shares, 0);
    });

    it('can give access to referenced columns for a form', async function() {
      // Use a fixture, since references with display columns are
      // awkward to set up via the api
      await freshDoc('FilmsWithImages.grist');

      // Publish an empty share.
      await owner.applyUserActions(docId, [
        ['AddRecord', '_grist_Shares', null, {
          linkId: 'x',
          options: '{"publish": true}'
        }],
      ]);
      await owner.applyUserActions(docId, [
        // Turn on sharing on Friends widget on Friends page.
        ['UpdateRecord', '_grist_Views_section', 7,
         {shareOptions: '{"publish": true, "form": true}'}],
        ['UpdateRecord', '_grist_Pages', 2, {shareRef: 1}],
        // Add some access rules too - there was a bug where references were
        // null if a multi-column table rule was present.
        ['AddRecord', '_grist_ACLResources', -1, {tableId: 'Films', colIds: 'Title,Poster,PosterDup'}],
        ['AddRecord', '_grist_ACLResources', -2, {tableId: 'Films', colIds: '*'}],
        ['AddRecord', '_grist_ACLRules', null, {
          resource: -1, aclFormula: 'user.access != OWNER', permissionsText: '-R',
        }],
        ['AddRecord', '_grist_ACLRules', null, {
          resource: -2, aclFormula: 'True', permissionsText: 'all',
        }],
      ]);

      const ham = await home.createHomeApi('ham', 'docs', true);
      const hamDoc = ham.getDocAPI(docId);
      const hamShare = ham.getDocAPI(await getShareKeyForUrl('x'));

      // Friends looks empty.
      assert.deepEqual(await hamShare.getRecords('Friends'), []);
      await assert.isRejected(hamDoc.getRecords('Friends'), /Forbidden/);

      // Films has just a title.
      assert.deepEqual(await hamShare.getRecords('Films'), [
        { id: 1, fields: { Title: 'Toy Story' } },
        { id: 2, fields: { Title: 'Forrest Gump' } },
        { id: 3, fields: { Title: 'Alien' } },
        { id: 4, fields: { Title: 'Avatar' } },
        { id: 5, fields: { Title: 'The Dark Knight' } },
        { id: 6, fields: { Title: 'The Avengers' } }
      ]);
      await assert.isRejected(hamDoc.getRecords('Films'), /Forbidden/);

      // Performance is not involved.
      await assert.isRejected(hamShare.getRecords('Performances'), /Forbidden/);
      await assert.isRejected(hamDoc.getRecords('Performances'), /Forbidden/);

      // Find "Favorite Film" field on single section of "Friends" view.
      const field = (await owner.getDocAPI(docId).sql(
        'select v.name, v.type, t.tableId, f.id, c.colId, s.title from _grist_Views_section_field as f' +
            ' left join _grist_Views_section s on s.id = f.parentId' +
            ' left join _grist_Tables_column c on c.id = f.colRef' +
            ' left join _grist_Tables t on t.id = c.parentId' +
            ' left join _grist_Views v on v.id = s.parentId' +
            ' where v.name = ? and c.colId = ? and s.title = ?',
        [ 'Friends', 'Favorite_Film', '' ],
      )).records[0].fields;
      assert.equal(field.colId, 'Favorite_Film');

      // Double check we can read film titles currently.
      assert.deepEqual(await hamShare.getRecords('Films'), [
        { id: 1, fields: { Title: 'Toy Story' } },
        { id: 2, fields: { Title: 'Forrest Gump' } },
        { id: 3, fields: { Title: 'Alien' } },
        { id: 4, fields: { Title: 'Avatar' } },
        { id: 5, fields: { Title: 'The Dark Knight' } },
        { id: 6, fields: { Title: 'The Avengers' } }
      ]);
      // Hide the field that refers to film titles.
      await owner.applyUserActions(docId, [[
        "RemoveRecord", "_grist_Views_section_field", field.id,
      ]]);
      // Check we can no longer read film titles in the share.
      await assert.isRejected(hamShare.getRecords('Films'), /Forbidden/);

      await removeShares(docId, owner);
    });

    it('are separate from document access rules', async function() {
      await freshDoc('FilmsWithImages.grist');
      await owner.applyUserActions(docId, [
        ['AddRecord', '_grist_Shares', null, {
          linkId: 'x',
          options: '{"publish": true}'
        }],
      ]);
      await owner.applyUserActions(docId, [
        ['UpdateRecord', '_grist_Views_section', 7,
         {shareOptions: '{"publish": true, "form": true}'}],
        ['UpdateRecord', '_grist_Pages', 2, {shareRef: 1}],
      ]);
      const ham = await home.createHomeApi('ham', 'docs', true);
      const hamDoc = ham.getDocAPI(docId);
      const hamShare = ham.getDocAPI(await getShareKeyForUrl('x'));
      const ownerDoc = owner.getDocAPI(docId);

      // Check that neither share nor doc can update records.
      await owner.applyUserActions(docId, [
        ['AddRecord', '_grist_ACLResources', -1, {tableId: 'Films', colIds: 'Title,Budget_millions'}],
        ['AddRecord', '_grist_ACLResources', -2, {tableId: '*', colIds: '*'}],
        ['AddRecord', '_grist_ACLRules', null, {
          resource: -1, aclFormula: 'True', permissionsText: '+R',
        }],
        ['AddRecord', '_grist_ACLRules', null, {
          resource: -2, aclFormula: 'True', permissionsText: '-U',
        }],
      ]);
      assert.deepEqual(await ownerDoc.getRows('_grist_ACLRules'), {
        id: [1, 2, 3],
        aclColumn: [0, 0, 0],
        resource: [1, 2, 3],
        memo: ['', '', ''],
        aclFormula: ['', 'True', 'True'],
        userAttributes: ['', '', ''],
        aclFormulaParsed: ['', '["Const", true]', '["Const", true]'],
        permissionsText: ['', '+R', '-U'],
        rulePos: [null, 1, 2],
        principals: ['[1]', '', ''],
        permissions: [63, 0, 0],
      });
      await assertDeniedFor(hamDoc.updateRows('Films', {id: [1], Title: ['Toy Story 2']}), [], /No view access/);
      await assertDeniedFor(hamShare.updateRows('Films', {id: [1], Title: ['Toy Story 2']}), []);
      await assertDeniedFor(ownerDoc.updateRows('Films', {id: [1], Title: ['Toy Story 2']}), [],
        /Blocked by table update access rules/);

      // Grant update permission to doc. Check that the share still can't update records.
      await owner.applyUserActions(docId, [
        ['UpdateRecord', '_grist_ACLRules', 3, {permissionsText: '+U'}],
      ]);
      assert.deepEqual(await ownerDoc.getRows('_grist_ACLRules'), {
        id: [1, 2, 3],
        aclColumn: [0, 0, 0],
        resource: [1, 2, 3],
        memo: ['', '', ''],
        aclFormula: ['', 'True', 'True'],
        userAttributes: ['', '', ''],
        aclFormulaParsed: ['', '["Const", true]', '["Const", true]'],
        permissionsText: ['', '+R', '+U'],
        rulePos: [null, 1, 2],
        principals: ['[1]', '', ''],
        permissions: [63, 0, 0],
      });
      await assert.isRejected(hamDoc.updateRows('Films', {id: [1], Title: ['Toy Story 2']}), /Forbidden/);
      await assertDeniedFor(hamShare.updateRows('Films', {id: [1], Title: ['Toy Story 2']}), []);
      await assert.isFulfilled(ownerDoc.updateRows('Films', {id: [1], Title: ['Toy Story 2']}));

      await removeShares(docId, owner);
    });

    it('can give access to a pair of form-shared widgets on same page', async function() {
      await freshDoc('ManyRefs.grist');

      // Publish an empty share.
      await owner.applyUserActions(docId, [
        ['AddRecord', '_grist_Shares', null, {
          linkId: 'manyref',
          options: '{"publish": true}'
        }],
      ]);
      // viewsections 19 and 20, parent view 7, page 7.
      await owner.applyUserActions(docId, [
        // Turn on sharing on "Dashboard" page
        ['UpdateRecord', '_grist_Pages', 7, {shareRef: 1}],
        // Turn on form-sharing on "FILM" section
        ['UpdateRecord', '_grist_Views_section', 19,
         {shareOptions: '{"publish": true, "form": true}'}],
        // Turn on form-sharing on "CUSTOMER" section
        ['UpdateRecord', '_grist_Views_section', 20,
         {shareOptions: '{"publish": true, "form": true}'}],
      ]);

      const ham = await home.createHomeApi('kiwi', 'docs', true);
      const hamShare = ham.getDocAPI(await getShareKeyForUrl('manyref'));

      // Friends looks empty - we just have rights to add records.
      // assert.deepEqual(await anonDoc.getRecords('Film'), []);
      // Can read some Actor columns, Codes for a Ref in one section,
      // and Name for a RefList in another section.

      // Some material is readable from Actor table for a reference
      // and a ref list.
      assert.deepEqual(await hamShare.getRecords('Actor'), [
        { id: 1, fields: { Code: 'ACT101', Name: 'Impressive Name' } },
        { id: 2, fields: { Code: 'ACT102', Name: 'Implausible Name' } }
      ]);

      // No content readable from Films, but the read is allowed
      // (a bit of a hack to allow form-like submissions via
      // regular web client).
      assert.deepEqual(await hamShare.getRecords('Film'), []);

      // Customer is a bit complicated. Reads allowed, but mostly
      // no content available - EXCEPT for a column referenced by
      // another shared widget.
      const censored: any = [ 'C' ];
      assert.deepEqual(await hamShare.getRecords('Customer'), [
        {
          id: 1,
          fields: {
            Name: "J Public",
            Year_Joined: censored,
            Good_Customer: censored,
            Fav_Actor_Code: censored,
          }
        },
        {
          id: 2,
          fields: {
            Name: "K Public",
            Year_Joined: censored,
            Good_Customer: censored,
            Fav_Actor_Code: censored,
          }
        }
      ]);

      // Make sure that basic functionality of adding rows works,
      // for the expected tables.
      await hamShare.addRows('Film', { Name: ['Foo'] });
      await hamShare.addRows('Customer', { Name: ['Foo'] });
      await assert.isRejected(hamShare.addRows('Actor', { Name: ['Foo'] }));
      await removeShares(docId, owner);
      const shares = await home.dbManager.connection.query('select * from shares');
      assert.lengthOf(shares, 0);
    });

    it('can use shares after a copy', async function() {
      await freshDoc();

      // Publish an empty share.
      await owner.applyUserActions(docId, [
        ['AddRecord', '_grist_Shares', null, {
          linkId: 'x2',
          options: '{"publish": true}'
        }],
      ]);

      // Check it reached the home db.
      let shares = await home.dbManager.connection.query('select * from shares');
      assert.lengthOf(shares, 1);
      assert.equal(shares[0].link_id, 'x2');

      const copyDocId = await owner.copyDoc(docId, wsId, {
        documentName: 'copy',
      });
      // Do anything with the new document.
      await owner.getDocAPI(copyDocId).getRows('Table1');
      shares = await home.dbManager.connection.query('select * from shares');
      assert.lengthOf(shares, 2);
      assert.equal(shares[0].link_id, 'x2');
      assert.equal(shares[1].link_id, 'x2');
      assert.notEqual(shares[0].doc_id, shares[1].doc_id);
      await removeShares(docId, owner);
      await removeShares(copyDocId, owner);
    });

    // There was a bug where some access rules were so bad recovery mode
    // couldn't start.
    it('can recover from certain bad access rules', async function() {
      await freshDoc('BadRules.grist');
      await assert.isRejected(
        owner.getDocAPI(docId).getRows('Table1'),
        /Duplicate ACLResource 4: an ACLResource with the same tableId and colIds already exists/
      );
      await owner.getDocAPI(docId).recover(true);
      await assert.isFulfilled(owner.getDocAPI(docId).getRows('Table1'));
    });
  });

  it('handles column types correctly when rows are created', async function() {
    await freshDoc();
    await owner.applyUserActions(docId, [
      ['AddTable', 'Data1', [{id: 'A'}, {id: 'B', type: 'Bool'}]],
      ['AddRecord', 'Data1', null, {A: 12, B: true}],
      ['AddRecord', 'Data1', null, {A: 13, B: false}],
      ['AddRecord', 'Data1', null, {A: 14}],
      ['AddRecord', '_grist_ACLResources', -1, {tableId: 'Data1', colIds: '*'}],
      // This is a rule that will behave differently if a cell is unset versus
      // set with its default value.
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -1, aclFormula: 'user.Access != OWNER and rec.B == False', permissionsText: 'none',
      }],
    ]);

    // Check editor's view is limited, as expected.
    assert.deepEqual(await editor.getDocAPI(docId).getRecords('Data1'), [
      { id: 1, fields: { A: '12', B: true } },
    ]);
    cliEditor.flush();

    // Add a record without specifying a value for the Bool column.
    await owner.applyUserActions(docId, [
      ['AddRecord', 'Data1', null, {A: 15}],
    ]);
    // Check editor sees correct records when enumerating them.
    assert.deepEqual(await editor.getDocAPI(docId).getRecords('Data1'), [
      { id: 1, fields: { A: '12', B: true } },
    ]);

    // A bad broadcast used to go out by this point, based on a Bool
    // being null instead of false during rule evalation and not
    // matching exact access rule check. Check that hasn't happened.
    assert.equal(cliEditor.count(), 0);

    // Check that if something should get broadcast, it does.
    await owner.applyUserActions(docId, [
      ['AddRecord', 'Data1', null, {A: 16, B: true}],
    ]);
    assert.deepEqual(await editor.getDocAPI(docId).getRecords('Data1'), [
      { id: 1, fields: { A: '12', B: true } },
      { id: 5, fields: { A: '16', B: true } },
    ]);
    assert.deepEqual((await cliEditor.readDocUserAction()), [
      [ 'AddRecord', 'Data1', 5, { A: '16', B: true, manualSort: 5 } ]
    ]);
  });

  it('is respected by /compare', async function() {

    // The /compare endpoint should work for anyone with full read access.
    await freshDoc();
    await owner.applyUserActions(docId, [
      ['AddTable', 'Table2', [{id: 'A', type: 'Int'}, {id: 'B', type: 'Int'}]],
    ]);
    const states = (await owner.getDocAPI(docId).getStates()).states;
    assert.lengthOf(states, 2);
    const v0 = states[0].h;
    const v1 = states[1].h;
    await assert.isFulfilled(editor.getDocAPI(docId).compareVersion(v1, v0));
    await assert.isFulfilled(editor.getDocAPI(docId).compareDoc(docId, {detail: true}));

    // The /compare endpoint should fail for anyone without full read
    // access, currently.
    await owner.applyUserActions(docId, [
      ['AddRecord', '_grist_ACLResources', -1, {tableId: 'Table2', colIds: '*'}],
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -1, aclFormula: 'user.Access != OWNER', permissionsText: '-R',
      }],
    ]);
    await assert.isFulfilled(owner.getDocAPI(docId).compareVersion(v1, v0));
    await assert.isFulfilled(owner.getDocAPI(docId).compareDoc(docId, {detail: true}));
    await assert.isRejected(editor.getDocAPI(docId).compareVersion(v1, v0), /insufficient access/);
    await assert.isRejected(editor.getDocAPI(docId).compareDoc(docId, {detail: true}), /insufficient access/);
  });
});

async function closeClient(cli: GristClient) {
  if (cli.isOpen()) {
    await cli.send("closeDoc", 0);
  }
  await cli.close();
}

// Create a wrapper to check that some property doesn't change during a test.
function assertUnchanged(check: () => PromiseLike<any>) {
  return async (body: PromiseLike<any>) => {
    const pre = await check();
    await body;
    const post = await check();
    assert.deepEqual(pre, post);
  };
}

async function assertDeniedFor(check: Promise<any>, memos: string[], test = /access rules/) {
  try {
    await check;
    throw new Error('not denied');
  } catch (e) {
    assert.match(e?.details?.userError, test);
    assert.deepEqual(e?.details?.memos ?? [], memos);
  }
}

// Read the content of an attachment, as text.
async function getAttachment(api: UserAPI, docId: string, attId: number) {
  const userApi = api as UserAPIImpl;
  const result = await userApi.testRequest(
    userApi.getBaseUrl() + `/api/docs/${docId}/attachments/${attId}/download`, {
      headers: userApi.defaultHeadersWithoutContentType()
    }
  );
  return result.text();
}

async function assertFlux(check: Promise<any>) {
  try {
    await check;
    throw new Error('not denied');
  } catch (e) {
    assert.match(e?.details?.userError, /Document in flux/);
  }
}
