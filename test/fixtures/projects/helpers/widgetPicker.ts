/**
 * This modules contains helpers to generate toy data for the widget picker.
 */

import {syncedKoArray} from 'app/client/lib/koArray';
import {ColumnRec, TableRec} from 'app/client/models/DocModel';
import {observable, toKo} from 'grainjs';
import * as ko from 'knockout';
import range = require('lodash/range');

function table(id: number, name: string) {
  return {id: ko.observable(id), tableId: ko.observable(name), tableNameDef: ko.observable(name)} as any as TableRec;
}

let colCounter = 0;
function column(id: number, name: string, tableRef: number) {
  return {
    id: ko.observable(id),
    label: ko.observable(name),
    parentId: ko.observable(tableRef),
    parentPos: ko.observable(++colCounter),
    isHiddenCol: ko.observable(false)
  } as any as ColumnRec;
}

export const tables = observable([
  table(0, 'Companies'),
  table(1, 'History'),
  table(2, 'A table with a very very long name, which include a description'),
  ...range(6).map((i) => table(3 + i, `Table${i}`))
]);

export const columns = observable([
  column(0, 'Field', 0),
  column(1, 'company_id', 1),
  column(2, 'URL', 1),
  column(3, 'city', 1),
  column(4, 'Long long long column name, because why not', 2),
  ...range(10).map((i) => column(4 + i, `column`, 3))
]);

const tablesKo = syncedKoArray(toKo(ko, tables));
const columnsKo = syncedKoArray(toKo(ko, columns));

export const gristDocMock: any = {
  docModel: {
    visibleTables: tablesKo,
    columns: {
      createAllRowsModel: () => columnsKo
    }
  },
  behavioralPromptsManager: {
    attachPopup: () => {},
  }
};
