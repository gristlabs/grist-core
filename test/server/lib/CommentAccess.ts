import {DocData} from 'app/common/DocData';
import {UserAPI} from 'app/common/UserAPI';
import {DocManager} from 'app/server/lib/DocManager';
import {CellData, getSingleAction, GranularAccess} from 'app/server/lib/GranularAccess';
import {TestServer} from 'test/gen-server/apiUtils';
import {GristClient, openClient} from 'test/server/gristClient';
import * as testUtils from 'test/server/testUtils';
import {assert} from 'chai';

describe('CommentAccess', function() {
  this.timeout(60000);
  let home: TestServer;
  testUtils.setTmpLogLevel('error');
  let owner: UserAPI;
  let editor: UserAPI;
  let docId: string;
  let wsId: number;
  let cliOwner: GristClient;
  let cliEditor: GristClient;
  let ownerRef: string;
  let editorRef: string;
  let docManager: DocManager;

  async function getWebsocket(api: UserAPI) {
    const who = await api.getSessionActive();
    return openClient(home.server, who.user.email, who.org?.domain || 'docs');
  }

  async function getGranularAccess(): Promise<GranularAccess> {
    const doc = await docManager.getActiveDoc(docId);
    return (doc as any)._granularAccess;
  }

  before(async function() {
    home = new TestServer(this);
    await home.start(['home', 'docs']);
    const api = await home.createHomeApi('chimpy', 'docs', true);
    await api.newOrg({name: 'testy', domain: 'testy'});
    owner = await home.createHomeApi('chimpy', 'testy', true);
    wsId = await owner.newWorkspace({name: 'ws'}, 'current');
    await owner.updateWorkspacePermissions(wsId, {
      users: {
        'charon@getgrist.com': 'editors',
      }
    });
    editor = await home.createHomeApi('charon', 'testy', true);
    const who = await owner.getSessionActive();
    ownerRef = who.user.ref || '';
    docManager = (home.server as any)._docManager;
    editorRef = (await editor.getSessionActive()).user.ref || '';
  });

  async function close(cli: GristClient) {
    try {
      await cli.send("closeDoc", 0);
    } catch (e) {
      // Do not worry if socket is already closed by the other side.
      if (!String(e).match(/WebSocket is not open/)) {
        throw e;
      }
    }
    await cli.close();
  }

  afterEach(async function() {
    if (docId) {
      for (const cli of [cliEditor, cliOwner]) {
        await close(cli);
      }
      docId = "";
    }
  });

  after(async function() {
    const api = await home.createHomeApi('chimpy', 'docs');
    await api.deleteOrg('testy');
    await home.stop();
  });

  async function freshDoc() {
    docId = await owner.newDoc({name: 'doc'}, wsId);
    cliEditor = await getWebsocket(editor);
    cliOwner = await getWebsocket(owner);
    await cliEditor.openDocOnConnect(docId);
    await cliOwner.openDocOnConnect(docId);
  }


  it('creates proper snapshot', async function() {
    await testDoc();
    const access = await getGranularAccess();
    const docData: DocData = (access as any)._docData;

    // We don't have comments yet, so we should have empty snapshot.
    let snapshot = await access.createSnapshotWithCells([]);
    assert.equal(snapshot.getTables().size, 27);
    assert.equal(snapshot.getTable('_grist_Cells')?.getRowIds().length, 0);
    assert.equal(snapshot.getTable('Chat')?.getRowIds().length, 0);
    assert.equal(snapshot.getTable('_grist_Tables')?.getRowIds().length, 3);
    assert.equal(snapshot.getTable('_grist_Tables_column')?.getRowIds().length, 10);

    // Now simulate updating some rows.
    snapshot = await access.createSnapshotWithCells([
      ['UpdateRecord', 'Chat', 1, {'Censored': 'test1'}],
    ]);
    const firstRowTest = () => {
      assert.deepEqual(snapshot.getTable('Chat')?.getTableDataAction(), ['TableData', 'Chat', [1], {
        manualSort: [1],
        Public: [0],
        Private: [''],
        Censored: ['']
      }]);
    };
    firstRowTest();

    // Simulate that row was just added.
    snapshot = await access.createSnapshotWithCells([
      ['AddRecord', 'Chat', 1, {}],
    ]);
    assert.deepEqual(snapshot.getTable('Chat')?.getTableDataAction(), ['TableData', 'Chat', [], {
      manualSort: [],
      Public: [],
      Private: [],
      Censored: []
    }]);

    // Simulate row removal, we should have this row.
    snapshot = await access.createSnapshotWithCells([
      ['RemoveRecord', 'Chat', 1],
    ]);
    firstRowTest();

    // Now put some comments there, and check snapshot once again.
    await send(owner, 'Public', "Message1", 1);
    await send(owner, 'Public', "Message2", 2);

    snapshot = await access.createSnapshotWithCells([
      ['UpdateRecord', 'Chat', 1, {'Censored': 'test1'}],
    ]);
    firstRowTest();
    // We have all cells in snapshot
    assert.deepEqual(
      snapshot.getTable('_grist_Cells')?.getTableDataAction(),
      docData.getTable('_grist_Cells')?.getTableDataAction()
    );
    snapshot = await access.createSnapshotWithCells([
      ['AddRecord', 'Chat', 1, {}],
    ]);
    assert.deepEqual(snapshot.getTable('Chat')?.getTableDataAction(), ['TableData', 'Chat', [], {
      manualSort: [],
      Public: [],
      Private: [],
      Censored: []
    }]);
    assert.deepEqual(
      snapshot.getTable('_grist_Cells')?.getTableDataAction(),
      docData.getTable('_grist_Cells')?.getTableDataAction()
    );
    snapshot = await access.createSnapshotWithCells([
      ['RemoveRecord', 'Chat', 1],
    ]);
    assert.deepEqual(
      snapshot.getTable('_grist_Cells')?.getTableDataAction(),
      docData.getTable('_grist_Cells')?.getTableDataAction()
    );

    // Now simulate adding a comment, we should corresponding table row in snapshot.
    snapshot = await access.createSnapshotWithCells([
      ['UpdateRecord', '_grist_Cells', 1, {}],
    ]);
    firstRowTest();
    snapshot = await access.createSnapshotWithCells([
      ['UpdateRecord', '_grist_Cells', 2, {}],
    ]);
    assert.deepEqual(snapshot.getTable('Chat')?.getTableDataAction(), ['TableData', 'Chat', [2], {
      manualSort: [2],
      Public: [0],
      Private: [''],
      Censored: ['']
    }]);

    snapshot = await access.createSnapshotWithCells([
      ['RemoveRecord', '_grist_Cells', 2],
    ]);
    assert.deepEqual(snapshot.getTable('Chat')?.getTableDataAction(), ['TableData', 'Chat', [2], {
      manualSort: [2],
      Public: [0],
      Private: [''],
      Censored: ['']
    }]);

    snapshot = await access.createSnapshotWithCells([
      ['BulkRemoveRecord', '_grist_Cells', [1, 2]],
    ]);
    assert.deepEqual(snapshot.getTable('Chat')?.getTableDataAction(), ['TableData', 'Chat', [1, 2], {
      manualSort: [1, 2],
      Public: [0, 0],
      Private: ['', ''],
      Censored: ['', '']
    }]);

    // Now simulate adding a comment, that is detached (we are overusing it). Since this method is using current
    // state, it will fetch comments data from the database, even though we are just adding them
    // and they are detached.
    snapshot = await access.createSnapshotWithCells([
      ['BulkAddRecord', '_grist_Cells', [1, 2], {}],
    ]);
    assert.deepEqual(snapshot.getTable('Chat')?.getTableDataAction(), ['TableData', 'Chat', [1, 2], {
      manualSort: [1, 2],
      Public: [0, 0],
      Private: ['', ''],
      Censored: ['', '']
    }]);
    assert.deepEqual(
      snapshot.getTable('_grist_Cells')?.getTableDataAction(),
      docData.getTable('_grist_Cells')?.getTableDataAction()
    );

    // Add comment in a proper way.
    snapshot = await access.createSnapshotWithCells([
      ['AddRecord', '_grist_Cells', 3, {
        tableRef: await tableRef('Chat'),
        colRef: await colRef('Chat', 'Public'),
        rowId: 1,
        content: 'Message',
        type: 1,
        root: 1,
        userRef: ownerRef,
      }],
    ]);
    assert.deepEqual(snapshot.getTable('Chat')?.getTableDataAction(), ['TableData', 'Chat', [1], {
      manualSort: [1],
      Public: [0],
      Private: [''],
      Censored: ['']
    }]);
    assert.deepEqual(
      snapshot.getTable('_grist_Cells')?.getTableDataAction(),
      docData.getTable('_grist_Cells')?.getTableDataAction()
    );
    // The snapshot doesn't have this comment - it still gets comments from the current state.
    assert.isUndefined(snapshot.getTable('_grist_Cells')?.getRecord(3));
    assert.isDefined(snapshot.getTable('_grist_Cells')?.getRecord(2));
    assert.isDefined(snapshot.getTable('_grist_Cells')?.getRecord(1));
    assert.equal(snapshot.getTable('_grist_Cells')?.getRecords()?.length, 2);

    snapshot = await access.createSnapshotWithCells([
      ['AddRecord', '_grist_Cells', 7, {
        tableRef: await tableRef('Chat'),
        colRef: await colRef('Chat', 'Public'),
        rowId: 2,
        content: 'Message',
        type: 1,
        root: 1,
        userRef: ownerRef,
      }],
    ]);
    assert.deepEqual(snapshot.getTable('Chat')?.getTableDataAction(), ['TableData', 'Chat', [2], {
      manualSort: [2],
      Public: [0],
      Private: [''],
      Censored: ['']
    }]);
    assert.deepEqual(
      snapshot.getTable('_grist_Cells')?.getTableDataAction(),
      docData.getTable('_grist_Cells')?.getTableDataAction()
    );
    assert.deepEqual(
      snapshot.getTable('_grist_Cells')?.getTableDataAction(),
      docData.getTable('_grist_Cells')?.getTableDataAction()
    );

    snapshot = await access.createSnapshotWithCells([
      ['BulkUpdateRecord', '_grist_Cells', [1, 2], {}],
    ]);
    assert.deepEqual(snapshot.getTable('Chat')?.getTableDataAction(), ['TableData', 'Chat', [1, 2], {
      manualSort: [1, 2],
      Public: [0, 0],
      Private: ['', ''],
      Censored: ['', '']
    }]);

    // Now simulate adding a comment to a nonexisting row.
    // Method still should work, but it shouldn't get any data.
    snapshot = await access.createSnapshotWithCells([
      ['BulkAddRecord', '_grist_Cells', [8], {}],
    ]);
    assert.deepEqual(snapshot.getTable('Chat')?.getTableDataAction(), ['TableData', 'Chat', [], {
      manualSort: [],
      Public: [],
      Private: [],
      Censored: []
    }]);
  });

  async function testDoc() {
    await freshDoc();
    await owner.applyUserActions(docId, [
      ['AddTable', 'Chat', [{id: 'Public', type: 'Int'}, {id: 'Private'}, {id: 'Censored'}]],
      ['AddTable', 'Public', [{id: 'A', type: 'Text'}]],
      ['AddRecord', '_grist_ACLResources', -1, {tableId: 'Chat', colIds: 'Private'}],
      ['AddRecord', '_grist_ACLResources', -2, {tableId: '*', colIds: '*'}],
      ['AddRecord', '_grist_ACLResources', -3, {tableId: 'Chat', colIds: 'Censored'}],
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -1, aclFormula: 'user.Access == "owners" # owner check', permissionsText: 'all',
      }],
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -1, aclFormula: '', permissionsText: 'none',
      }],
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -2, aclFormula: 'user.Access != "owners"', permissionsText: '-S',  // drop schema rights
      }],
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -3, aclFormula: 'user.Access != "owners" and rec.Public <= 0', permissionsText: 'none',
      }],
      ['AddRecord', 'Chat', null, {Public: 0}],
      ['AddRecord', 'Chat', null, {Public: 0}],
    ]);
    cliEditor.flush();
    cliOwner.flush();
  }

  it('should convert bulk actions to single actions', async function() {
    deepEqual(Array.from(getSingleAction([
      'BulkAddRecord', 'Chat', [1, 2], {Name: ['First', 'Second']}
    ])), [
      ["AddRecord", "Chat", 1, {"Name": "First"}],
      ["AddRecord", "Chat", 2, {"Name": "Second"}]
    ]);
    deepEqual(Array.from(getSingleAction([
      'BulkUpdateRecord', 'Chat', [1, 2], {Name: ['First', 'Second']}
    ])), [
      ["UpdateRecord", "Chat", 1, {"Name": "First"}],
      ["UpdateRecord", "Chat", 2, {"Name": "Second"}]
    ]);
    deepEqual(Array.from(getSingleAction([
      'BulkRemoveRecord', 'Chat', [2, 3]
    ])), [
      ["RemoveRecord", "Chat", 2], ["RemoveRecord", "Chat", 3]
    ]);
    deepEqual(Array.from(getSingleAction([
      'RemoveRecord', 'Chat', 1
    ])), [
      ["RemoveRecord", "Chat", 1]
    ]);
    deepEqual(Array.from(getSingleAction([
      'AddRecord', 'Chat', 1, {}
    ])), [
      ['AddRecord', 'Chat', 1, {}]
    ]);
    deepEqual(Array.from(getSingleAction([
      'RemoveRecord', 'Chat', 1
    ])), [
      ['RemoveRecord', 'Chat', 1]
    ]);
  });

  it('should help with cell extractions', async function() {
    await testDoc();
    await send(owner, "Private", "First");
    await send(owner, "Public", "Second");
    await send(owner, "Censored", "Third");
    const access = await getGranularAccess();
    const helper = new CellData((access as any)._docData);

    // First test some basic helpers.
    deepEqual(helper.getCell(1), {
      "tableId": "Chat", "colId": "Private", "rowId": 1, "userRef": ownerRef, "id": 1
    });
    assert.isNull(helper.getCell(400));
    assert.equal(helper.getColId(6), "Public");
    assert.equal(helper.getColRef(2, 'Public'), 6);
    assert.isUndefined(helper.getColRef(1, 'Public2'));
    assert.isUndefined(helper.getColRef(22, 'Public'));
    assert.isUndefined(helper.getColId(20));
    assert.equal(helper.getTableId(2), "Chat");
    assert.isUndefined(helper.getTableId(20));
    assert.isUndefined(helper.getTableRef('Chat2'));
    assert.equal(helper.getTableRef('Chat'), 2);

    // Test method that converts docActions for _grist_Cells to a list of cells.
    deepEqual(helper.convertToCells(['RemoveColumn', 'Table1', 'Test']), []);
    // Single cell extractions from docData
    deepEqual(helper.convertToCells(['UpdateRecord', '_grist_Cells', 1, {}]),
      [{"tableId": "Chat", "colId": "Private", "rowId": 1, userRef: ownerRef, "id": 1}]
    );
    deepEqual(helper.convertToCells(['AddRecord', '_grist_Cells', 1, {tableRef: 10}]),
      [{"tableId": "Chat", "colId": "Private", "rowId": 1, userRef: ownerRef, "id": 1}]
    );
    deepEqual(helper.convertToCells(['RemoveRecord', '_grist_Cells', 1]),
      [{"tableId": "Chat", "colId": "Private", "rowId": 1, userRef: ownerRef, "id": 1}]
    );
    deepEqual(helper.convertToCells(['BulkRemoveRecord', '_grist_Cells', [1]]),
      [{"tableId": "Chat", "colId": "Private", "rowId": 1, userRef: ownerRef, "id": 1}]
    );
    deepEqual(helper.convertToCells(['BulkAddRecord', '_grist_Cells', [1], {}]),
      [{"tableId": "Chat", "colId": "Private", "rowId": 1, userRef: ownerRef, "id": 1}]
    );
    deepEqual(helper.convertToCells(['BulkUpdateRecord', '_grist_Cells', [1], {}]),
      [{"tableId": "Chat", "colId": "Private", "rowId": 1, userRef: ownerRef, "id": 1}]
    );
    // Multiple doc extractions from docData
    deepEqual(helper.convertToCells(['BulkUpdateRecord', '_grist_Cells', [1, 2], {}]),
      [
        {"tableId": "Chat", "colId": "Private", "rowId": 1, userRef: ownerRef, "id": 1},
        {"tableId": "Chat", "colId": "Public", "rowId": 1, userRef: ownerRef, "id": 2}
      ]
    );
    deepEqual(helper.convertToCells(['BulkAddRecord', '_grist_Cells', [1, 2], {}]),
      [
        {"tableId": "Chat", "colId": "Private", "rowId": 1, userRef: ownerRef, "id": 1},
        {"tableId": "Chat", "colId": "Public", "rowId": 1, userRef: ownerRef, "id": 2}
      ]
    );
    deepEqual(helper.convertToCells(['BulkRemoveRecord', '_grist_Cells', [1, 2]]),
      [
        {"tableId": "Chat", "colId": "Private", "rowId": 1, userRef: ownerRef, "id": 1},
        {"tableId": "Chat", "colId": "Public", "rowId": 1, userRef: ownerRef, "id": 2}
      ]
    );
    deepEqual(helper.convertToCells(['BulkRemoveRecord', '_grist_Cells', [1, 10]]),
      [
        {"tableId": "Chat", "colId": "Private", "rowId": 1, userRef: ownerRef, "id": 1},
        // 10 is not a valid cell id
      ]
    );
    deepEqual(helper.convertToCells(['UpdateRecord', '_grist_Cells', 10, {}]), []);
    // Extract from docAction itself
    deepEqual(helper.convertToCells(['AddRecord', '_grist_Cells', 44, {
      tableRef: helper.getTableRef('Chat')!,
      rowId: 1,
      colRef: helper.getColRef(helper.getTableRef('Chat')!, 'Public')!,
      userRef: ownerRef
    }]),
      [
        {"tableId": "Chat", "colId": "Public", "rowId": 1, userRef: ownerRef, "id": 44}
      ]
    );
    deepEqual(helper.convertToCells(['UpdateRecord', '_grist_Cells', 44, {
      tableRef: helper.getTableRef('Chat')!,
      rowId: 1,
      colRef: helper.getColRef(helper.getTableRef('Chat')!, 'Public')!,
      userRef: ownerRef
    }]),
      [
        {"tableId": "Chat", "colId": "Public", "rowId": 1, userRef: ownerRef, "id": 44}
      ]
    );
    deepEqual(helper.convertToCells(['BulkUpdateRecord', '_grist_Cells', [44], {
      tableRef: [helper.getTableRef('Chat')!],
      rowId: [1],
      colRef: [helper.getColRef(helper.getTableRef('Chat')!, 'Public')!],
      userRef: [ownerRef!]
    }]),
      [
        {"tableId": "Chat", "colId": "Public", "rowId": 1, userRef: ownerRef, "id": 44}
      ]
    );

    // Test BulkUpdateRecord action generation from list of SingleCells.
    deepEqual(helper.generateUpdate([]), null);
    deepEqual(helper.generateUpdate([1]), [
      "UpdateRecord", "_grist_Cells", 1, {
        "content": "First",
        userRef: ownerRef
      }
    ]);
    deepEqual(helper.generateUpdate([1, 2]), [
      "BulkUpdateRecord", "_grist_Cells", [1, 2], {
        "content": ['First', 'Second'],
        "userRef": [ownerRef, ownerRef]
      }
    ]);

    // Test detection if docAction is enough to create a cell metadata row.
    assert.equal(helper.hasCellInfo(['AddRecord', '_grist_Cells', 1, {
      tableRef: helper.getTableRef('Chat')!,
      rowId: 1,
      colRef: helper.getColRef(helper.getTableRef('Chat')!, 'Public')!,
      userRef: ownerRef
    }]), true);

    assert.equal(helper.hasCellInfo(['AddRecord', '_grist_Cells', 1, {
      rowId: 1,
      colRef: helper.getColRef(helper.getTableRef('Chat')!, 'Public')!,
      userRef: ownerRef
    }]), false);

    assert.equal(helper.hasCellInfo(['AddRecord', '_grist_Cells', 1, {
      tableRef: helper.getTableRef('Chat')!,
      colRef: helper.getColRef(helper.getTableRef('Chat')!, 'Public')!,
      userRef: ownerRef
    }]), false);

    assert.equal(helper.hasCellInfo(['AddRecord', '_grist_Cells', 1, {
      tableRef: helper.getTableRef('Chat')!,
      rowId: 1,
      userRef: ownerRef
    }]), false);

    assert.equal(helper.hasCellInfo(['AddRecord', '_grist_Cells', 1, {
      tableRef: helper.getTableRef('Chat')!,
      colRef: helper.getColRef(helper.getTableRef('Chat')!, 'Public')!,
      rowId: 1,
    }]), false);

    // Test conversion between MetaRecord and SingleCell.
    deepEqual(helper.convertToCellInfo(helper.getCellRecord(1)!), helper.getCell(1)!);
    deepEqual(helper.convertToCellInfo(helper.getCellRecord(2)!), helper.getCell(2)!);

    deepEqual(helper.readCells('Chat', new Set([1, 2])), [
      helper.getCell(1)!,
      helper.getCell(2)!,
      helper.getCell(3)!
    ]);
  });

  it('should create proper cell metadata actions', async function() {
    await testDoc();
    await send(owner, "Private", "First");
    await send(owner, "Public", "Second");
    await send(owner, "Censored", "Third");
    const access = await getGranularAccess();
    const helper = new CellData((access as any)._docData);

    deepEqual(helper.generatePatch([
      ['AddRecord', '_grist_Cells', 1, {
        tableRef: helper.getTableRef('Chat')!,
        rowId: 1,
        colRef: helper.getColRef(helper.getTableRef('Chat')!, 'Public')!,
      }],
      ['AddRecord', '_grist_Cells', 2, {
        tableRef: helper.getTableRef('Chat')!,
        rowId: 1,
        colRef: helper.getColRef(helper.getTableRef('Chat')!, 'Public')!,
      }],
      ['AddRecord', 'Chat', 3, {}]
    ]), [
      ["BulkAddRecord", "_grist_Cells", [1, 2], {
        "tableRef": [2, 2],
        "colRef": [7, 6],
        "type": [1, 1],
        "root": [true, true],
        "rowId": [1, 1],
        // Data is read from docData.
        "content": ["First", "Second"],
        "userRef": [ownerRef, ownerRef]
      }]
    ]);

    // Now we are removing row, and since metadata was added in the same bundle, nothing is sent.
    deepEqual(helper.generatePatch([
      ['AddRecord', '_grist_Cells', 1, {
        tableRef: helper.getTableRef('Chat')!,
        rowId: 1,
        colRef: helper.getColRef(helper.getTableRef('Chat')!, 'Public')!,
      }],
      ['AddRecord', '_grist_Cells', 2, {
        tableRef: helper.getTableRef('Chat')!,
        rowId: 1,
        colRef: helper.getColRef(helper.getTableRef('Chat')!, 'Public')!,
      }],
      ['RemoveRecord', 'Chat', 1],
      ['RemoveRecord', '_grist_Cells', 1],
      ['RemoveRecord', '_grist_Cells', 2],
    ]), null);

    // Now we are removing row and adding one comment, existing comment will be removed.
    deepEqual(helper.generatePatch([
      ['AddRecord', '_grist_Cells', 1, {
        tableRef: helper.getTableRef('Chat')!,
        rowId: 1,
        colRef: helper.getColRef(helper.getTableRef('Chat')!, 'Public')!,
      }],
      ['RemoveRecord', 'Chat', 1],
      ['RemoveRecord', '_grist_Cells', 1],
      ['RemoveRecord', '_grist_Cells', 2],
    ]), [
      ['RemoveRecord', '_grist_Cells', 2]
    ]);

    // Now we are updating row, and expect patch to be sent, that updates content for all cells.
    deepEqual(helper.generatePatch([
      ['UpdateRecord', 'Chat', 1, {}],
    ]), [
      ["BulkUpdateRecord", "_grist_Cells", [1, 2, 3], {
        "content": ["First", "Second", "Third"],
        "userRef": [ownerRef, ownerRef, ownerRef]
      }]
    ]);

    // Now we are updating row and comments in the same bundle, all updates are sent.
    deepEqual(helper.generatePatch([
      ['UpdateRecord', 'Chat', 1, {}],
      ['UpdateRecord', '_grist_Cells', 1, {}],
    ]), [
      ["BulkUpdateRecord", "_grist_Cells", [1, 2, 3], {
        "content": ["First", "Second", "Third"],
        "userRef": [ownerRef, ownerRef, ownerRef]
      }]
    ]);

    const first = helper.getCellRecord(1)!;
    // Now we are adding a row, adding a comment to it, and updating it in the same bundle.
    deepEqual(helper.generatePatch([
      ['AddRecord', 'Chat', 1, {}],
      ['AddRecord', '_grist_Cells', 1, {
        tableRef: first.tableRef,
        rowId: 1,
        colRef: first.colRef,
      }],
      ['UpdateRecord', 'Chat', 1, {}],
    ]), [
      ['AddRecord', '_grist_Cells', 1, {
        tableRef: first.tableRef,
        rowId: 1,
        colRef: first.colRef,
        content: first.content,
        root: true,
        type: 1,
        userRef: ownerRef
      }],
      // Update is sent only for existing cells.
      ["BulkUpdateRecord", "_grist_Cells", [2, 3], {
        "content": ["Second", "Third"],
        "userRef": [ownerRef, ownerRef]
      }]
    ]);
  });

  it('should create proper patch with schema actions', async function() {
    await testDoc();
    // We have single public comment, it should be returned when we modify the 1st row.
    await send(owner, 'Public', "Message", 1);
    cliEditor.flush();
    cliOwner.flush();
    await owner.applyUserActions(docId, [
      ['UpdateRecord', 'Chat', 1, {Censored: 'Updated'}],
    ]);
    deepEqual(await cliEditor.readDocUserAction(), [
      ["UpdateRecord", "Chat", 1, {"Censored": ["C"]}],
      ["UpdateRecord", "_grist_Cells", 1, {"content": "Message", "userRef": ownerRef}],
    ]);
    // Test if patch is created correctly when, records are updated
    // before table was renamed.
    await owner.applyUserActions(docId, [
      ['UpdateRecord', 'Chat', 1, {Censored: 'Updated2'}],
      ['RenameTable', 'Chat', 'Chat2'],
    ]);
    deepEqual(await cliEditor.readDocUserAction(), [
      ["UpdateRecord", "Chat", 1, {"Censored": ["C"]}],
      ["RenameTable", "Chat", "Chat2"],
      ["UpdateRecord", "_grist_Tables", 2, {"tableId": "Chat2"}],
      ["UpdateRecord", "_grist_Cells", 1, {"content": "Message", "userRef": ownerRef}],
    ]);
    await owner.applyUserActions(docId, [
      ['UpdateRecord', 'Chat2', 1, {Censored: 'Updated3'}],
      ['RemoveTable', 'Chat2'],
    ]);
    deepEqual(await cliEditor.readDocUserAction(), [
      ["UpdateRecord", "Chat2", 1, {"Censored": ["C"]}],
      ["BulkRemoveRecord", "_grist_Views_section_field", [10, 11, 12, 13, 14, 15, 16, 17, 18]],
      ["BulkRemoveRecord", "_grist_Views_section", [4, 5, 6]],
      ["UpdateRecord", "_grist_Tables", 2, {"rawViewSectionRef": 0}],
      ["UpdateRecord", "_grist_Tables", 2, {"recordCardViewSectionRef": 0}],
      ["RemoveRecord", "_grist_TabBar", 2],
      ["RemoveRecord", "_grist_Pages", 2],
      ["RemoveRecord", "_grist_Views", 2],
      ["UpdateRecord", "_grist_Tables", 2, {"primaryViewId": 0}],
      ["BulkRemoveRecord", "_grist_Tables_column", [5, 6, 7, 8]],
      ["RemoveRecord", "_grist_Tables", 2],
      ["RemoveTable", "Chat2"],
      ["RemoveRecord", "_grist_Cells", 1] // we only see that the cell was removed, not updated.
    ]);
  });

  it('respects private conversation', async function() {
    await testDoc();

    await send(owner, "Private", "First");
    await read(cliOwner, "Private", "First", ownerRef);
    await read(cliEditor, "Private", ['C'], '');

    await send(owner, "Public", "Second");
    await read(cliOwner, "Public", "Second", ownerRef);
    await read(cliEditor, "Public", "Second", ownerRef);

    await send(owner, "Censored", "Third");
    await read(cliOwner, "Censored", "Third", ownerRef);
    await read(cliEditor, "Censored", ['C'], '');

    // Now reveal the private conversation to the editor.
    await censorChat(false);
    deepEqual(await cliOwner.readDocUserAction(), [
      ["UpdateRecord", "Chat", 1, {"Public": 1}],
      ["BulkUpdateRecord", "_grist_Cells", [1, 2, 3], {
        "content": ["First", "Second", "Third"],
        "userRef": [ownerRef, ownerRef, ownerRef]
      }]
    ]);
    deepEqual(await cliEditor.readDocUserAction(), [
      ["UpdateRecord", "Chat", 1, {"Public": 1}],
      ["BulkUpdateRecord", "Chat", [1], {"Censored": [""]}],
      ["BulkUpdateRecord", "_grist_Cells", [1, 2, 3], {
        "content": [["C"], "Second", "Third"],
        "userRef": ['', ownerRef, ownerRef]
      }]
    ]);

    // Now hide it once again
    await censorChat(true);
    deepEqual(await cliOwner.readDocUserAction(), [
      ["UpdateRecord", "Chat", 1, {"Public": 0}],
      ["BulkUpdateRecord", "_grist_Cells", [1, 2, 3], {
        "content": ["First", "Second", "Third"],
        "userRef": [ownerRef, ownerRef, ownerRef]
      }]
    ]);
    deepEqual(await cliEditor.readDocUserAction(), [
      ["UpdateRecord", "Chat", 1, {"Public": 0}],
      ["BulkUpdateRecord", "Chat", [1], {"Censored": [["C"]]}],
      ["BulkUpdateRecord", "_grist_Cells", [1, 2, 3], {
        "content": [["C"], "Second", ["C"]],
        "userRef": ['', ownerRef, ""]
      }]
    ]);
  });

  it('works across non-trivial bundles', async function() {
    await testDoc();
    await send(owner, "Censored", "Secret");
    await censorChat(true);
    // We have one comment at Censored column, that is currently censored.
    deepContains(await editor.getTable(docId, "_grist_Cells"), {
      content: [['C']], userRef: ['']
    });
    deepContains(await owner.getTable(docId, "_grist_Cells"), {
      content: ["Secret"], userRef: [ownerRef],
    });
    cliEditor.flush(); cliOwner.flush();
    // Now rename table, and trigger comments retrieval, by updating a cell.
    await owner.applyUserActions(docId, [
      ["UpdateRecord", "Chat", 1, {"Censored": "test1"}],
      ["RenameTable", "Chat", "Chat2"],
      ["RenameColumn", "Chat2", "Censored", "Censored2"],
      ["UpdateRecord", "Chat2", 1, {"Censored2": "test2"}]
    ]);
    deepEqual(await cliOwner.readDocUserAction(), [
      ["UpdateRecord", "Chat", 1, {"Censored": "test1"}],
      ["RenameTable", "Chat", "Chat2"],
      ["UpdateRecord", "_grist_Tables", 2, {"tableId": "Chat2"}],
      ["BulkUpdateRecord", "_grist_ACLResources", [2, 4], {"tableId": ["Chat2", "Chat2"]}],
      ["RenameColumn", "Chat2", "Censored", "Censored2"],
      ["UpdateRecord", "_grist_Tables_column", 8, {"colId": "Censored2"}],
      ["UpdateRecord", "_grist_ACLResources", 4, {"colIds": "Censored2"}],
      ["UpdateRecord", "Chat2", 1, {"Censored2": "test2"}],
      ["UpdateRecord", "_grist_Cells", 1, {
        "content": "Secret", userRef: ownerRef
      }]
    ]);
    deepEqual(await cliEditor.readDocUserAction(), [
      ["UpdateRecord", "Chat", 1, {"Censored": ["C"]}],
      ["RenameTable", "Chat", "Chat2"],
      ["UpdateRecord", "_grist_Tables", 2, {"tableId": "Chat2"}],
      ["RenameColumn", "Chat2", "Censored", "Censored2"],
      ["UpdateRecord", "_grist_Tables_column", 8, {"colId": "Censored2"}],
      ["UpdateRecord", "Chat2", 1, {"Censored2": ["C"]}],
      ["UpdateRecord", "_grist_Cells", 1, {"content": ["C"], "userRef": ""}]
    ]);

    const ChatTable = 2, Censored = 8;

    // Now test some things with column removals, and renames.
    // TODO: this doesn't work currently - ACL doesn't work well when columns are removed and renamed.
    // await owner.applyUserActions(docId, [
    //   ["RenameTable", "Chat2", "Chat"],
    //   ["RenameColumn", "Chat", "Censored2", "Censored"],
    //   ["RemoveColumn", "Chat", "Censored"]
    // ]);

    // First make sure that we are censoring cells still.
    await owner.applyUserActions(docId, [
      ['AddRecord', '_grist_Cells', null, {
        tableRef: ChatTable, colRef: Censored, rowId: 1, type: 1, root: true, userRef: ownerRef,
        content: "New Secret",
      }],
    ]);
    deepEqual(await cliOwner.readDocUserAction(), [
      ["AddRecord", "_grist_Cells", 2, {
        "colRef": Censored, "content": "New Secret",
        "userRef": ownerRef, "root": true, "rowId": 1, "tableRef": ChatTable, "type": 1
      }],
    ]);
    deepEqual(await cliEditor.readDocUserAction(), [
      ["AddRecord", "_grist_Cells", 2, {
        "colRef": Censored, "content": ['C'],
        "userRef": "", "root": true, "rowId": 1, "tableRef": ChatTable, "type": 1
      }],
    ]);

    // And now add a comment, and remove a row in the same bundle.
    // This is not trivial, as cell info is censored after the fact.
    await owner.applyUserActions(docId, [
      ['AddRecord', '_grist_Cells', null, {
        tableRef: ChatTable, colRef: Censored, rowId: 1, type: 1, root: true, userRef: ownerRef,
        content: 'New Secret',
      }],
      ['RemoveRecord', 'Chat2', 1]
    ]);
    deepEqual(await cliOwner.readDocUserAction(), [
      ["RemoveRecord", "Chat2", 1],
      ["BulkRemoveRecord", "_grist_Cells", [1, 2]]
    ]);
    deepEqual(await cliEditor.readDocUserAction(), [
      ["RemoveRecord", "Chat2", 1],
      ["BulkRemoveRecord", "_grist_Cells", [1, 2]]
    ]);
  });

  it('rejects updates when needed', async function() {
    await testDoc();
    await send(owner, "Censored", "Secret");
    await censorChat(true);
    // We have one comment at Censored column, that is currently censored.
    deepContains(await editor.getTable(docId, "_grist_Cells"), {
      content: [['C']], userRef: ['']
    });
    deepContains(await owner.getTable(docId, "_grist_Cells"), {
      id: [1],
      content: ['Secret'], userRef: [ownerRef],
    });
    cliEditor.flush(); cliOwner.flush();

    // Check that editor can't update or remove owners comment.
    await assert.isRejected(editor.applyUserActions(docId, [
      ['UpdateRecord', '_grist_Cells', 1, {content: 'hack'}],
    ]));
    await assert.isRejected(editor.applyUserActions(docId, [
      ['UpdateRecord', '_grist_Cells', 1, {userRef: editorRef}],
    ]));
    await assert.isRejected(editor.applyUserActions(docId, [
      ['UpdateRecord', '_grist_Cells', 1, {colRef: await colRef('Chat', 'Public')}],
    ]));
    await assert.isRejected(editor.applyUserActions(docId, [
      ['UpdateRecord', '_grist_Cells', 1, {tableRef: await tableRef('Public')}],
    ]));
    await assert.isRejected(editor.applyUserActions(docId, [
      ['UpdateRecord', '_grist_Cells', 1, {rowId: 2}],
    ]));
    await assert.isRejected(editor.applyUserActions(docId, [
      ['RemoveRecord', '_grist_Cells', 1],
    ]));
    await assert.isRejected(editor.applyUserActions(docId, [
      ['BulkRemoveRecord', '_grist_Cells', [1]],
    ]));

    // Can add a comment to a Public column.
    await send(owner, "Public", "Message"); // 2
    await send(owner, "Private", "Secret"); // 3
    await send(owner, "Censored", "Secret"); // 4
    await send(editor, "Public", "Public"); // 5

    // Can't add a comment to a Private or Censored column.
    await assert.isRejected(send(editor, "Private", "Secret"));
    await assert.isRejected(send(editor, "Censored", "Secret"));
    deepContains(await owner.getTable(docId, "_grist_Cells"), {
      id: [1, 2, 3, 4, 5],
    });
    // Rejects comments that is send in partial, but are attached to
    // a cell.
    await assert.isRejected(editor.applyUserActions(docId, [
      ['AddRecord', '_grist_Cells', null, {
        tableRef: await tableRef("Chat"),
        colRef: await colRef("Chat", "Private"),
        rowId: 1,
        type: 1, root: true, userRef: editorRef, content: 'test'
      }]
    ]));
    await assert.isRejected(editor.applyUserActions(docId, [
      ['AddRecord', '_grist_Cells', null, {
        tableRef: await tableRef("Chat"),
        colRef: await colRef("Chat", "Private"),
        type: 1, root: true, userRef: editorRef, content: 'test'
      }],
      ['UpdateRecord', '_grist_Cells', 6, {rowId: 1}]
    ]));
    await assert.isRejected(editor.applyUserActions(docId, [
      ['AddRecord', '_grist_Cells', null, {
        tableRef: await tableRef("Chat"),
        type: 1, root: true, userRef: editorRef, content: 'test'
      }],
      ['UpdateRecord', '_grist_Cells', 6, {rowId: 1}],
      ['UpdateRecord', '_grist_Cells', 6, {colRef: await colRef("Chat", "Private")}]
    ]));
    await assert.isRejected(editor.applyUserActions(docId, [
      ['AddRecord', '_grist_Cells', null, {
        type: 1, root: true, userRef: editorRef, content: 'test'
      }],
      ['UpdateRecord', '_grist_Cells', 6, {rowId: 1}],
      ['UpdateRecord', '_grist_Cells', 6, {colRef: await colRef("Chat", "Private")}],
      ['UpdateRecord', '_grist_Cells', 6, {tableRef: await tableRef("Chat")}]
    ]));

    // Those are partial actions, that will success, but they won't add any comments
    // as data-engine will remove comments that are not attached.
    await assert.isFulfilled(editor.applyUserActions(docId, [
      ['AddRecord', '_grist_Cells', null, {
        type: 1, root: true, userRef: editorRef, content: 'test'
      }],
      // ['UpdateRecord', '_grist_Cells', 6, {rowId: 1}],
      ['UpdateRecord', '_grist_Cells', 6, {colRef: await colRef("Chat", "Public")}],
      ['UpdateRecord', '_grist_Cells', 6, {tableRef: await tableRef("Chat")}]
    ]));
    await assert.isFulfilled(editor.applyUserActions(docId, [
      ['AddRecord', '_grist_Cells', null, {
        type: 1, root: true, userRef: editorRef, content: 'test'
      }],
      ['UpdateRecord', '_grist_Cells', 6, {rowId: 1}],
      // ['UpdateRecord', '_grist_Cells', 6, {colRef: await colRef("Chat", "Public")}],
      ['UpdateRecord', '_grist_Cells', 6, {tableRef: await tableRef("Chat")}]
    ]));
    await assert.isFulfilled(editor.applyUserActions(docId, [
      ['AddRecord', '_grist_Cells', null, {
        type: 1, root: true, userRef: editorRef, content: 'test'
      }],
      ['UpdateRecord', '_grist_Cells', 6, {rowId: 1}],
      ['UpdateRecord', '_grist_Cells', 6, {colRef: await colRef("Chat", "Public")}],
      // ['UpdateRecord', '_grist_Cells', 6, {tableRef: await tableRef("Chat")}]
    ]));
    deepContains(await owner.getTable(docId, "_grist_Cells"), {
      id: [1, 2, 3, 4, 5],
      content: ["Secret", "Message", "Secret", "Secret", "Public"],
    });
    // Make sure that editor can update its own comments.
    // 1 - owner comment, 5 editor comment.
    await assert.isFulfilled(editor.applyUserActions(docId, [
      ['UpdateRecord', '_grist_Cells', 5, {content: 'ok'}],
    ]));
    deepContains(await owner.getTable(docId, "_grist_Cells"), {
      content: ["Secret", "Message", "Secret", "Secret", "ok"],
    });
    // Try to move comment to a private channel.
    await assert.isRejected(editor.applyUserActions(docId, [
      ['UpdateRecord', '_grist_Cells', 5, {colRef: await colRef("Chat", "Private")}],
    ]));
    await assert.isFulfilled(editor.applyUserActions(docId, [
      ['BulkRemoveRecord', '_grist_Cells', [5]],
    ]));
    deepContains(await owner.getTable(docId, "_grist_Cells"), {
      id: [1, 2, 3, 4],
    });
  });

  async function censorChat(censor: boolean) {
    await owner.applyUserActions(docId, [
      ['UpdateRecord', 'Chat', 1, {Public: censor ? 0 : 1}],
    ]);
  }

  async function read(client: GristClient, chat: string, message: any, from: string) {
    const cells = await owner.getTable(docId, '_grist_Cells');
    deepEqual(await client.readDocUserAction(), [
      ['AddRecord', '_grist_Cells', cells.id.length, {
        content: message,
        userRef: from,
        colRef: await colRef('Chat', chat),
        tableRef: await tableRef('Chat'),
        rowId: 1,
        root: true,
        type: 1
      }]
    ]);
  }

  async function send(api: UserAPI, chat: string, message: string, rowId = 1) {
    const who = await api.getSessionActive();
    await api.applyUserActions(docId, [
      ['AddRecord', '_grist_Cells', null, {
        tableRef: await tableRef('Chat'),
        colRef: await colRef('Chat', chat),
        rowId,
        type: 1,
        root: true,
        userRef: who.user.ref || '',
        content: message
      }]
    ]);
  }

  function deepEqual(a: any, b: any) {
    assert.deepEqual(a, b, `Expected \n${JSON.stringify(a)} to equal \n${JSON.stringify(b)}`);
  }

  function deepContains(a: any, b: any) {
    a = {...a};
    Object.keys(a).filter(key => !(key in b)).forEach(key => delete a[key]);
    assert.deepEqual(a, b, `Expected \n${JSON.stringify(a)} to equal \n${JSON.stringify(b)}`);
  }

  async function tableRef(tableId: string) {
    const tables = await owner.getTable(docId, '_grist_Tables');
    return tables.id[tables.tableId.findIndex(id => id === tableId)];
  }

  async function colRef(tableId: string, colId: string) {
    const tRef = await tableRef(tableId);
    const columns = await owner.getTable(docId, '_grist_Tables_column');
    return columns.id[columns.colId.findIndex(
      (val, idx) => val === colId && tRef === columns.parentId[idx])
    ];
  }
});
