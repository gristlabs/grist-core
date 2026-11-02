import { TableDataAction } from "app/common/DocActions";
import { schema } from "app/common/schema";

import { assert } from "chai";
import { JSDOM } from "jsdom";

/* eslint-disable @typescript-eslint/no-require-imports */

// Must be loaded before any browser global is installed, so that jQuery hands back its factory.
const jqueryFactory = require("jquery");

// DocModel's import graph reads bare window/document/$ at module load (DocData's gristNotify,
// ace, mousetrap, DateEditor's datepicker monkey-patch), bypassing the browserGlobals indirection
// that clientUtil.setTmpMochaGlobals() repoints - so we install real globals around a require().
// We remove them afterwards to leave other suites alone; constructing a DocModel also reaches
// window (urlState), so the suite reinstalls them around the tests.
const jsdomWindow = new JSDOM("<!doctype html><html></html>", { url: "http://localhost" }).window;
const browserGlobals = ["window", "document", "$"];

function installBrowserGlobals() {
  Object.assign(global, {
    window: jsdomWindow,
    document: jsdomWindow.document,
    $: jqueryFactory(jsdomWindow),
  });
}

function removeBrowserGlobals() {
  for (const key of browserGlobals) {
    delete (global as any)[key];
  }
}

installBrowserGlobals();
const { DocData } = require("app/client/models/DocData") as typeof import("app/client/models/DocData");
const { DocModel } = require("app/client/models/DocModel") as typeof import("app/client/models/DocModel");
removeBrowserGlobals();

const TABLE_REF = 1;
const SUMMARY_TABLE_REF = 2;
const COL_REF = 2;
const SECTION_REF = 1;

/**
 * Metadata for a user table "Table1", with a manualSort column (so that row-dragging is
 * possible), a data column "A", and a raw view section, plus a summary table of it (to tell the
 * locked-only computeds apart from the ones that summaries also restrict). DocModel requires all
 * metadata tables to be loaded, so the ones we don't care about start out empty; columns omitted
 * from an action get their schema default.
 */
function createMetaTables(): { [tableId: string]: TableDataAction } {
  const metaTables: { [tableId: string]: TableDataAction } = {};
  for (const tableId of Object.keys(schema)) {
    metaTables[tableId] = ["TableData", tableId, [], {}];
  }
  return Object.assign(metaTables, {
    _grist_DocInfo: ["TableData", "_grist_DocInfo", [1], { docId: ["1"], documentSettings: ["{}"] }],
    _grist_Tables: ["TableData", "_grist_Tables", [TABLE_REF, SUMMARY_TABLE_REF], {
      tableId: ["Table1", "GristSummary_6_Table1"],
      rawViewSectionRef: [SECTION_REF, 0],
      summarySourceTable: [0, TABLE_REF],
      locked: [false, false],
    }],
    _grist_Tables_column: ["TableData", "_grist_Tables_column", [1, COL_REF], {
      parentId: [TABLE_REF, TABLE_REF],
      parentPos: [1, 2],
      colId: ["manualSort", "A"],
      type: ["ManualSortPos", "Text"],
    }],
    _grist_Views_section: ["TableData", "_grist_Views_section", [SECTION_REF], {
      tableRef: [TABLE_REF],
      parentKey: ["record"],
      title: ["Table1"],
    }],
  });
}

describe("DocModel", function() {
  before(installBrowserGlobals);
  after(removeBrowserGlobals);

  it("disables data and schema editing while the table is locked", function() {
    const docData = new DocData({ fetchTable: () => { throw new Error("Unexpected fetch"); } } as any,
      createMetaTables());
    const docModel = new DocModel(docData);
    const table = docModel.tables.getRowModel(TABLE_REF);
    const summaryTable = docModel.tables.getRowModel(SUMMARY_TABLE_REF);
    const column = docModel.columns.getRowModel(COL_REF);
    const section = docModel.viewSections.getRowModel(SECTION_REF);

    function assertDisabled(expected: boolean) {
      assert.equal(column.disableEditData(), expected, "column disableEditData");
      assert.equal(column.disableModify(), expected, "disableModify");
      assert.equal(table.disableAddRemoveRows(), expected, "disableAddRemoveRows");
      assert.equal(section.disableDragRows(), expected, "disableDragRows");
      assert.equal(table.disableAddRemoveColumns(), expected, "disableAddRemoveColumns");
      assert.equal(table.disableRenameTable(), expected, "disableRenameTable");
      assert.equal(table.disableRemoveTable(), expected, "disableRemoveTable");
      assert.equal(table.disableEditData(), expected, "table disableEditData");

      // A summary is never renamable, but adding columns is gated on locked alone, so the summary
      // still accepts new (formula) columns.
      assert.isTrue(summaryTable.disableRenameTable(), "summary disableRenameTable");
      assert.isFalse(summaryTable.disableAddRemoveColumns(), "summary disableAddRemoveColumns");
    }

    assertDisabled(false);

    // Flipping the flag should update all the computeds live, with no reload.
    docData.receiveAction(["UpdateRecord", "_grist_Tables", TABLE_REF, { locked: true }]);
    assertDisabled(true);

    docData.receiveAction(["UpdateRecord", "_grist_Tables", TABLE_REF, { locked: false }]);
    assertDisabled(false);

    docModel.dispose();
  });
});
