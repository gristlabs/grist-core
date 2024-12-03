/**
 * Unittest for OnDemandActions, which translates basic UserActions into DocActions along with
 * corresponding undo actions.
 */
import {TableDataAction, UserAction} from 'app/common/DocActions';
import {ActiveDoc} from 'app/server/lib/ActiveDoc';
import {makeExceptionalDocSession} from 'app/server/lib/DocSession';
import {DocStorage} from 'app/server/lib/DocStorage';
import {OnDemandActions, ProcessedAction} from 'app/server/lib/OnDemandActions';
import {assert} from 'chai';
import times = require('lodash/times');
import {createDocTools} from 'test/server/docTools';
import * as testUtils from 'test/server/testUtils';

describe('OnDemandActions', function() {
  this.timeout(10000);

  // Turn off logging for this test, and restore afterwards.
  testUtils.setTmpLogLevel('warn');

  const docTools = createDocTools({persistAcrossCases: true});
  const fakeSession = makeExceptionalDocSession('system');
  let activeDoc1: ActiveDoc;
  let onDemandActions: OnDemandActions;
  let docStorage: DocStorage;

  // Create an OnDemand table with a few rows and columns. We'll reuse it in all test cases.
  before(async function() {
    const docName = 'docOnDemandActions';
    activeDoc1 = await docTools.createDoc(docName);
    onDemandActions = (activeDoc1 as any)._onDemandActions;
    docStorage = activeDoc1.docStorage;

    const res = await activeDoc1.applyUserActions(fakeSession, [
      ["AddTable", "Foo", [
        { id: 'fname',      type: 'Text', isFormula: false },
        { id: 'lname',      type: 'Text', isFormula: false },
        { id: 'Birth_Date', type: 'Date', isFormula: false },
        { id: 'age',        type: 'Numeric', isFormula: false },
      ]]
    ]);
    const tableRef = res.retValues[0].id;

    // Make the table "on-demand" right away.
    await activeDoc1.applyUserActions(fakeSession, [
      ['UpdateRecord', '_grist_Tables', tableRef, {onDemand: true}]
    ]);
    await activeDoc1.applyUserActions(fakeSession, [
      ["BulkAddRecord", "Foo", initialData[2], initialData[3]]]);
  });

  // Initial data is used both to populate the initial data, and to verify that we get back to it
  // after undo.
  const initialData: TableDataAction = [
    'TableData', 'Foo', [1, 3, 4, 9], {
      fname:      [ 'Aa', 'Bb', 'Cc', 'Dd'],
      lname:      [ 'Xx', 'Yy', 'Zz', 'Ww'],
      Birth_Date: [ 123,  null, 456,  null],
      age:        [ 50,   null, 40,   null],
      manualSort: [ 1,    3,    4,    9],
    }];

  // Applies on-demand actions at a lower-level than ActiveDoc, so that we can get at their
  // generated UNDO actions.
  async function applyOnDemand(userAction: UserAction): Promise<ProcessedAction> {
    const processed = await onDemandActions.processUserAction(userAction);
    await docStorage.applyStoredActions(processed.stored);
    return processed;
  }

  it('should create correct (Bulk)UpdateRecord', async () => {
    const processed1 = await applyOnDemand(
      ['UpdateRecord', 'Foo', 4, {fname: 'Clyde', age: 45}]);
    const processed2 = await applyOnDemand(
      ['BulkUpdateRecord', 'Foo', [4, 9, 1],
        {lname: ['CX', 'DX', 'AX'], Birth_Date: [678, 909, null]}]);

    assert.deepEqual((await activeDoc1.fetchTable(fakeSession, 'Foo')).tableData,
      ['TableData', 'Foo', [1, 3, 4, 9], {
        fname:      [ 'Aa', 'Bb', 'Clyde', 'Dd'],
        lname:      [ 'AX', 'Yy', 'CX', 'DX'],
        Birth_Date: [ null, null, 678,  909],
        age:        [ 50,   null, 45,   null],
        manualSort: [ 1,    3,    4,    9],
      }]
    );
    await docStorage.applyStoredActions(processed2.undo);
    await docStorage.applyStoredActions(processed1.undo);
    assert.deepEqual((await activeDoc1.fetchTable(fakeSession, 'Foo')).tableData, initialData);

    // Make sure the generated undo actions are as we expect.
    assert.hasAllKeys(processed1.undo[0][3], ["fname", "age"]);
    assert.sameMembers(processed1.undo[0][2] as number[], [4]);
    assert.hasAllKeys(processed2.undo[0][3], ["lname", "Birth_Date"]);
    assert.sameMembers(processed2.undo[0][2] as number[], [4, 9, 1]);
  });

  it('should create correct (Bulk)AddRecord', async () => {
    const processed1 = await applyOnDemand(
      ['AddRecord', 'Foo', null, {Birth_Date: 234567}]);
    const processed2 = await applyOnDemand(
      ['BulkAddRecord', 'Foo', [null, null], {fname: ['Cou', 'Gar']}]);

    assert.deepEqual((await activeDoc1.fetchTable(fakeSession, 'Foo')).tableData,
      ['TableData', 'Foo', [1, 3, 4, 9,       10,     11,   12], {
        fname:      [ 'Aa', 'Bb', 'Cc', 'Dd', '',    'Cou', 'Gar'],
        lname:      [ 'Xx', 'Yy', 'Zz', 'Ww', '',     '',   ''],
        Birth_Date: [ 123,  null, 456,  null, 234567, null, null],
        age:        [ 50,   null, 40,   null, 0,      0,    0],
        manualSort: [ 1,    3,    4,    9,    10,     11,   12],
      }]
    );
    await docStorage.applyStoredActions(processed2.undo);
    await docStorage.applyStoredActions(processed1.undo);
    assert.deepEqual(await activeDoc1.fetchTable(fakeSession, 'Foo'),
                     {tableData: initialData});
  });

  it('should create correct (Bulk)RemoveRecord', async () => {
    const processed1 = await applyOnDemand(['RemoveRecord', 'Foo', 4]);
    const processed2 = await applyOnDemand(['BulkRemoveRecord', 'Foo', [9, 1]]);

    assert.deepEqual((await activeDoc1.fetchTable(fakeSession, 'Foo')).tableData,
      ['TableData', 'Foo', [3], {
        fname:      [ 'Bb' ],
        lname:      [ 'Yy' ],
        Birth_Date: [ null ],
        age:        [ null ],
        manualSort: [ 3    ],
      }]
    );
    await docStorage.applyStoredActions(processed2.undo);
    await docStorage.applyStoredActions(processed1.undo);
    assert.deepEqual(await activeDoc1.fetchTable(fakeSession, 'Foo'),
                     {tableData: initialData});
  });

  it('should handle actions bigger than maxSQLiteVariables', async function() {
    this.timeout(10000);
    const N = 1723;
    const processed1 = await applyOnDemand(
      ['BulkAddRecord', 'Foo', times(N, (i) => null), {}]);
    const processed2 = await applyOnDemand(
      ['BulkUpdateRecord', 'Foo', times(N, (i) => 10 + i), {age: times(N, (i) => i * 10)}]);

    const intermediate: TableDataAction = [
      'TableData', 'Foo', [1, 3, 4, 9,      ].concat(times(N, (i) => 10 + i)), {
      fname:      [ 'Aa', 'Bb', 'Cc', 'Dd', ].concat(times(N, (i) => '')),
      lname:      [ 'Xx', 'Yy', 'Zz', 'Ww', ].concat(times(N, (i) => '')),
      Birth_Date: [ 123,  null, 456,  null, ].concat(times(N, (i) => null)),
      age:        [ 50,   null, 40,   null, ].concat(times(N, (i) => i * 10)),
      manualSort: [ 1,    3,    4,    9,    ].concat(times(N, (i) => 10 + i)),
    }];

    assert.deepEqual(await activeDoc1.fetchTable(fakeSession, 'Foo'),
                     {tableData: intermediate});

    const processed3 = await applyOnDemand(
      ['BulkRemoveRecord', 'Foo', times(N, (i) => 10 + i)]);

    assert.deepEqual(await activeDoc1.fetchTable(fakeSession, 'Foo'),
                     {tableData: initialData});

    await docStorage.applyStoredActions(processed3.undo);
    assert.deepEqual(await activeDoc1.fetchTable(fakeSession, 'Foo'),
                     {tableData: intermediate});

    await docStorage.applyStoredActions(processed2.undo);
    await docStorage.applyStoredActions(processed1.undo);

    assert.deepEqual(await activeDoc1.fetchTable(fakeSession, 'Foo'),
                     {tableData: initialData});
  });
});
