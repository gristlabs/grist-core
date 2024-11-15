import {LocalActionBundle} from 'app/common/ActionBundle';
import {ActionGroup, MinimalActionGroup} from 'app/common/ActionGroup';
import {DocState} from 'app/common/UserAPI';
import {ActionGroupOptions, ActionHistory, ActionHistoryUndoInfo, asActionGroup,
        asMinimalActionGroup} from 'app/server/lib/ActionHistory';
import {ActionHistoryImpl, computeActionHash} from 'app/server/lib/ActionHistoryImpl';
import {DocStorage} from 'app/server/lib/DocStorage';
import {DocStorageManager} from 'app/server/lib/DocStorageManager';
import * as path from 'path';
import {createDocTools} from 'test/server/docTools';
import {assert} from 'test/server/testUtils';
import * as testUtils from 'test/server/testUtils';
import * as tmp from 'tmp';

/**
 *
 * A toy in-memory implementation of ActionHistory interface as a reference point.
 *
 */
class ToyActionHistory implements ActionHistory {
  private _storeLocalUnsent: LocalActionBundle[] = [];
  private _storeLocalSent: LocalActionBundle[] = [];
  private _storeShared: LocalActionBundle[] = [];
  private _actionNum: number = 1;
  private _localActionNum: number = 1;
  private _actionUndoInfo = new Map<string, ActionHistoryUndoInfo>();

  public async initialize(): Promise<void> {
    return;
  }

  public isInitialized(): boolean {
    return true;
  }

  public getNextHubActionNum(): number {
    return this._actionNum;
  }

  public getNextLocalActionNum(): number {
    return this._localActionNum;
  }

  public async skipActionNum(actionNum: number) {
    this._localActionNum = this._actionNum = actionNum + 1;
  }

  public haveLocalUnsent(): boolean {
    return this._storeLocalUnsent.length > 0;
  }

  public haveLocalSent(): boolean {
    return this._storeLocalSent.length > 0;
  }

  public haveLocalActions(): boolean {
    return this.haveLocalSent() || this.haveLocalUnsent();
  }

  public async fetchAllLocalUnsent(): Promise<LocalActionBundle[]> {
    return [... this._storeLocalUnsent];
  }

  public async fetchAllLocal(): Promise<LocalActionBundle[]> {
    return this._storeLocalSent.concat(this._storeLocalUnsent);
  }

  public async clearLocalActions(): Promise<void> {
    this._storeLocalSent.length = 0;
    this._storeLocalUnsent.length = 0;
    this._localActionNum = this._actionNum;
  }

  public async markAsSent(actions: LocalActionBundle[]): Promise<void> {
    for (const act of actions) {
      if (this._storeLocalUnsent.length === 0) {
        throw new Error("markAsSent() called but nothing local and unsent");
      }
      const candidate = this._storeLocalUnsent[0];
      // act and candidate must be one and the same
      if (computeActionHash(act) !==
          computeActionHash(candidate)) {
        throw new Error("markAsSent() got an unexpected action");
      }
      this._storeLocalSent.push(candidate);
      this._storeLocalUnsent.shift();
    }
  }

  public async getActions(actionNums: number[]): Promise<Array<LocalActionBundle|undefined>> {
    return actionNums.map(n => undefined);
  }

  public async acceptNextSharedAction(actionHash: string|null): Promise<boolean> {
    if (this._storeLocalSent.length === 0) {
      return false;
    }
    const candidate = this._storeLocalSent[0];
    if (actionHash != null) {
      const candidateActionHash = computeActionHash(candidate);
      if (candidateActionHash !== actionHash) {
        return false;
      }
    }
    this._storeLocalSent.shift();
    this._storeShared.push(candidate);
    this._noteSharedAction(candidate);
    return true;
  }

  public async recordNextLocalUnsent(action: LocalActionBundle): Promise<void> {
    this._storeLocalUnsent.push(action);
    this._noteLocalAction(action);
  }

  public async recordNextShared(action: LocalActionBundle): Promise<void> {
    this._storeShared.push(action);
    this._noteSharedAction(action);
  }

  public async getRecentActions(maxActions?: number): Promise<LocalActionBundle[]> {
    const actions = [...this._storeShared, ...this._storeLocalSent, ...this._storeLocalUnsent];
    if (!maxActions) { return actions; }
    return actions.slice(-maxActions);
  }

  public async getRecentActionGroups(maxActions: number, options: ActionGroupOptions): Promise<ActionGroup[]> {
    const actions = await this.getRecentActions(maxActions);
    return actions.map(a => asActionGroup(this, a, options));
  }

  public async getRecentMinimalActionGroups(maxActions: number, clientId?: string): Promise<MinimalActionGroup[]> {
    const actions = await this.getRecentActions(maxActions);
    return actions.map(a => asMinimalActionGroup(this,
                                                 {actionHash: a.actionHash!, actionNum: a.actionNum},
                                                 clientId));
  }

  public async getRecentStates(maxStates?: number): Promise<DocState[]> {
    const actions = await this.getRecentActions(maxStates);
    return actions.reverse().map(action => ({n: action.actionNum, h: action.actionHash!}));
  }

  public setActionUndoInfo(actionHash: string, undoInfo: ActionHistoryUndoInfo): void {
    this._actionUndoInfo.set(actionHash, undoInfo);
  }

  public getActionUndoInfo(actionHash: string): ActionHistoryUndoInfo | undefined {
    return this._actionUndoInfo.get(actionHash);
  }

  public async deleteActions(keepN: number): Promise<void> {
    throw new Error('not implemented');
  }

  private _noteSharedAction(action: LocalActionBundle): void {
    if (action.actionNum >= this._actionNum) {
      this._actionNum = action.actionNum + 1;
    }
    this._noteLocalAction(action);
  }

  private _noteLocalAction(action: LocalActionBundle): void {
    if (action.actionNum >= this._localActionNum) {
      this._localActionNum = action.actionNum + 1;
    }
  }
}

/** create a Grist document for testing, and return an instance of DocStorage */
async function getDoc(fname: string) {
  const manager = new DocStorageManager(".", ".");
  const storage = new DocStorage(manager, fname);
  await storage.createFile();
  return storage;
}

const versions: Array<{name: string,
                       createDoc: () => Promise<DocStorage|undefined>,
                       createHistory: (doc: DocStorage) => Promise<ActionHistory>}> = [
  {
    name: "ToyActionHistory",
    createDoc: () => Promise.resolve(undefined),
    createHistory: async (doc) => new ToyActionHistory()
  },
  {
    name: "ActionHistoryImplOnDisk",
    createDoc: () => {
      const tmpDir = tmp.dirSync({ prefix: 'grist_action_history_test_', unsafeCleanup: true });
      const fname = path.resolve(tmpDir.name, 'actionhistory.tmp.sqlite');
      return getDoc(fname);
    },
    createHistory: async (doc) => {
      const hist = new ActionHistoryImpl(doc);
      await hist.wipe();
      return hist;
    }
  }
];


/** set action.actionHash and action.parentActionHash as appropriate for the given actions */
function branchify(actions: LocalActionBundle[]) {
  let parentActionHash: string|null = null;
  for (const action of actions) {
    action.parentActionHash = parentActionHash;
    parentActionHash = action.actionHash = computeActionHash(action);
  }
}

function makeBundle(actionNum: number, desc: string): LocalActionBundle {
  return {
    actionNum,
    envelopes: [],
    info: [
      0,
      {
        time: 0,
        user: "",
        inst: "",
        desc,
        otherId: 0,
        linkId: 0
      }
    ],
    stored: [],
    calc: [],
    userActions: [],
    undo: [],
    parentActionHash: null,
    actionHash: null
  } as LocalActionBundle;
}


for (const version of versions) {

  describe(version.name, function() {

    // Comment this out to see debug-log output from PluginManager when debugging tests.
    testUtils.setTmpLogLevel('error');

    let doc: DocStorage|undefined;
    let history: ActionHistory;

    beforeEach(async () => {
      doc = await version.createDoc();
      history = await version.createHistory(doc!);
      await history.initialize();
    });

    async function getActions(maxActions?: number): Promise<number[]> {
      return (await history.getRecentActions(maxActions)).map(bundle => bundle.actionNum);
    }

    const b1 = makeBundle(1, "one");
    const b2 = makeBundle(2, "two");
    const b3 = makeBundle(3, "three");

    it('check actionNums increment', async function() {
      assert(history.isInitialized());
      assert.equal(history.getNextHubActionNum(), 1);
      assert.equal(history.getNextLocalActionNum(), 1);
      await history.recordNextShared(b1);
      assert.equal(history.getNextHubActionNum(), 2);
      assert.equal(history.getNextLocalActionNum(), 2);
      await history.recordNextLocalUnsent(b2);
      assert.equal(history.getNextHubActionNum(), 2);
      assert.equal(history.getNextLocalActionNum(), 3);
    });

    it('check path to acceptance', async function() {           // [shared | sent | unsent]
      await history.recordNextShared(b1);                       // [b1     |      |       ]
      assert.equal(history.getNextHubActionNum(), 2);
      await history.recordNextLocalUnsent(b2);                  // [b1     |      | b2    ]
      assert.equal(history.getNextHubActionNum(), 2);
      assert.equal(history.getNextLocalActionNum(), 3);
      const lst = await history.fetchAllLocalUnsent();
      branchify([b1, b2]);
      assert.deepEqual(lst, [b2]);
      assert(history.haveLocalActions());
      await history.markAsSent(lst);                            // [b1     | b2   |       ]
      assert.lengthOf(await history.fetchAllLocalUnsent(), 0);
      branchify([b1, b2]);
      assert.deepEqual(await history.fetchAllLocal(), [b2]);
      assert(history.haveLocalActions());
      const actionHash = computeActionHash(b2);
      assert(await history.acceptNextSharedAction(actionHash)); // [b1 b2  |      |       ]
      assert.lengthOf(await history.fetchAllLocal(), 0);
      assert(!history.haveLocalActions());
      assert.equal(history.getNextHubActionNum(), 3);
      assert.equal(history.getNextLocalActionNum(), 3);
    });

    it('check reject disordered', async function() {
      await history.recordNextLocalUnsent(b1);
      await history.recordNextLocalUnsent(b2);
      assert.equal(history.getNextLocalActionNum(), 3);
      await history.markAsSent(await history.fetchAllLocalUnsent());
      const actionHash = computeActionHash(b2);
      assert(!(await history.acceptNextSharedAction(actionHash)));
      branchify([b1, b2]);
      assert.deepEqual(await history.fetchAllLocal(), [b1, b2]);
    });

    it('markAsSent checks sanity', async function() {
      await assert.isRejected(history.markAsSent([b1]), /nothing local/);
      await history.recordNextLocalUnsent(b1);
      await assert.isRejected(history.markAsSent([b2]), /unexpected action/);
    });

    it('cleans local_unsent when local_sent is empty', async function() {
      await history.recordNextLocalUnsent(b1);
      await history.recordNextLocalUnsent(b2);
      assert.equal(history.getNextLocalActionNum(), 3);
      assert(history.haveLocalActions());
      assert.lengthOf(await history.fetchAllLocal(), 2);
      await history.clearLocalActions();
      assert(!history.haveLocalActions());
      assert.lengthOf(await history.fetchAllLocal(), 0);
      assert.equal(history.getNextHubActionNum(), 1);
      assert.equal(history.getNextLocalActionNum(), 1);
    });

    it('cleans local_sent when local_unsent is empty', async function() {
      await history.recordNextLocalUnsent(b1);
      await history.recordNextLocalUnsent(b2);
      await history.markAsSent(await history.fetchAllLocalUnsent());
      assert(history.haveLocalActions());
      assert.lengthOf(await history.fetchAllLocal(), 2);
      await history.clearLocalActions();
      assert(!history.haveLocalActions());
      assert.lengthOf(await history.fetchAllLocal(), 0);
      assert.equal(history.getNextHubActionNum(), 1);
      assert.equal(history.getNextLocalActionNum(), 1);
    });

    it('cleans local actions and continues correctly', async function() {
      await history.recordNextShared(b1);                       // [b1     |      |       ]
      await history.recordNextLocalUnsent(b2);                  // [b1     |      | b2    ]
      assert.deepEqual(await getActions(), [1, 2]);
      await history.clearLocalActions();                        // [b1     |      |       ]
      assert.deepEqual(await getActions(), [1]);
      await history.recordNextLocalUnsent(b3);                  // [b1     |      | b3    ]
      assert.deepEqual(await getActions(), [1, 3]);
    });

    it('handles non-trivial load', async function() {
      const target = 500;
      async function addRecords() {
        for (let i = 1; i <= target; i++) {
          await history.recordNextLocalUnsent(makeBundle(i, "action"));
        }
      }
      if (doc) {
        await doc.execTransaction(addRecords);
      } else {
        await addRecords();
      }
      assert(history.haveLocalActions());
      assert.lengthOf(await history.fetchAllLocal(), target);
      await history.markAsSent(await history.fetchAllLocalUnsent());
      assert.lengthOf(await history.fetchAllLocal(), target);
      assert(await history.acceptNextSharedAction(null));
      assert.lengthOf(await history.fetchAllLocal(), target - 1);
    });

    it('tracks ownership', async function() {
      await history.recordNextLocalUnsent(b1);
      await history.recordNextLocalUnsent(b2);
      const defaultUndoInfo = {linkId: 0, otherId: 0, isUndo: false, rowIdHint: 0};
      history.setActionUndoInfo(b1.actionHash!, {...defaultUndoInfo, clientId: "me"});
      history.setActionUndoInfo(b2.actionHash!, {...defaultUndoInfo, clientId: "you"});
      assert.equal(history.getActionUndoInfo(b1.actionHash!)?.clientId, "me");
      assert.equal(history.getActionUndoInfo(b2.actionHash!)?.clientId, "you");
    });

    it('tracks recent actions', async function() {
      assert.deepEqual(await getActions(), []);
      assert.deepEqual(await getActions(2), []);
      await history.recordNextShared(b1);
      assert.deepEqual(await getActions(), [1]);
      assert.deepEqual(await getActions(2), [1]);
      await history.recordNextLocalUnsent(b2);
      assert.deepEqual(await getActions(), [1, 2]);
      assert.deepEqual(await getActions(2), [1, 2]);
      await history.recordNextLocalUnsent(b3);
      assert.deepEqual(await getActions(), [1, 2, 3]);
      assert.deepEqual(await getActions(2), [2, 3]);
      await history.markAsSent(await history.fetchAllLocalUnsent());
      assert.deepEqual(await getActions(), [1, 2, 3]);
      assert.deepEqual(await getActions(2), [2, 3]);
    });

    it('can force next actionNum value', async function() {
      await history.skipActionNum(50);
      assert.equal(history.getNextHubActionNum(), 51);
      assert.equal(history.getNextLocalActionNum(), 51);
      await history.recordNextLocalUnsent(makeBundle(51, "51"));
      assert.equal(history.getNextHubActionNum(), 51);
      assert.equal(history.getNextLocalActionNum(), 52);
      await history.clearLocalActions();
      await history.recordNextShared(makeBundle(51, "51"));
      assert.equal(history.getNextHubActionNum(), 52);
      assert.equal(history.getNextLocalActionNum(), 52);
    });
  });
}

describe("ActionHistoryImpl only", function() {
  // Comment this out to see debug-log output from PluginManager when debugging tests.
  testUtils.setTmpLogLevel('error');

  const docTools = createDocTools();
  it('can persist actionNum across restarts', async function() {
    const doc = await docTools.createDoc("test.grist");
    const history = new ActionHistoryImpl(doc.docStorage);
    await history.initialize();
    await history.skipActionNum(50);
    assert.equal(history.getNextHubActionNum(), 51);
    await doc.shutdown();
    const doc2 = await docTools.loadDoc("test.grist");
    const history2 = new ActionHistoryImpl(doc2.docStorage);
    await history2.initialize();
    assert.equal(history2.getNextHubActionNum(), 51);
  });

  it('can access actions by actionNum', async function() {
    async function getServerActionNums(actionNums: number[]): Promise<number[]> {
      return (await history.getActions(actionNums))
        .map(act => act ? act.actionNum : 0);
    }
    const doc = await docTools.createDoc("test.grist");
    const history = new ActionHistoryImpl(doc.docStorage);
    await history.initialize();
    await history.skipActionNum(50);
    assert.equal(history.getNextHubActionNum(), 51);
    assert.deepEqual(await getServerActionNums([50]), [50]);
    await history.recordNextLocalUnsent(makeBundle(51, "51"));
    await history.recordNextLocalUnsent(makeBundle(52, "52"));
    await history.recordNextLocalUnsent(makeBundle(53, "53"));
    assert.deepEqual(await getServerActionNums([]), []);
    assert.deepEqual(await getServerActionNums([50]), [50]);
    assert.deepEqual(await getServerActionNums([49, 50, 51, 52, 53, 54]), [0, 50, 51, 52, 53, 0]);
    assert.deepEqual(await getServerActionNums([25]), [0]);
  });

  it('can automatically prune long history', async function() {
    const doc = await docTools.createDoc("test.grist");
    const history = new ActionHistoryImpl(doc.docStorage,
                                          {maxRows: 2, maxBytes: 40000, graceFactor: 2,
                                           checkPeriod: 1});
    await history.initialize();
    await history.recordNextShared(makeBundle(2, "action"));
    assert.lengthOf(await history.getRecentActions(), 2);
    await history.recordNextShared(makeBundle(3, "action"));
    assert.lengthOf(await history.getRecentActions(), 3);
    await history.recordNextShared(makeBundle(4, "action"));
    assert.lengthOf(await history.getRecentActions(), 4);
    await history.recordNextShared(makeBundle(5, "action"));
    assert.lengthOf(await history.getRecentActions(), 2);    // grace factor exceeded; pruned
    await history.recordNextShared(makeBundle(6, "action"));
    assert.lengthOf(await history.getRecentActions(), 3);
    await history.recordNextShared(makeBundle(7, "action"));
    assert.lengthOf(await history.getRecentActions(), 4);
    await history.recordNextShared(makeBundle(8, "action"));
    assert.lengthOf(await history.getRecentActions(), 2);    // grace factor exceeded; pruned
    await history.recordNextShared(makeBundle(9, "action"));
    assert.lengthOf(await history.getRecentActions(), 3);
    const acts = await history.getRecentActions();
    assert.equal(acts.pop()!.actionNum, 9);
    await doc.shutdown();
  });

  it('can automatically prune bulky history', async function() {
    const doc = await docTools.createDoc("test.grist");
    // Set byte limit sufficiently low to dominate.
    const history = new ActionHistoryImpl(doc.docStorage, {maxRows: 4, maxBytes: 1000,
                                                           graceFactor: 1.1, checkPeriod: 1});
    await history.initialize();
    for (let i = 1; i <= 10; i++) {
      await history.recordNextShared(makeBundle(i, "action"));
    }
    const acts = await history.getRecentActions();
    assert.lengthOf(acts, 2);
    assert.equal(acts.pop()!.actionNum, 10);
    await doc.shutdown();
  });
});
