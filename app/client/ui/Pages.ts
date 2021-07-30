import { createGroup } from "app/client/components/commands";
import { duplicatePage } from "app/client/components/duplicatePage";
import { GristDoc } from "app/client/components/GristDoc";
import { PageRec } from "app/client/models/DocModel";
import { urlState } from "app/client/models/gristUrlState";
import * as MetaTableModel from "app/client/models/MetaTableModel";
import { find as findInTree, fromTableData, TreeItemRecord } from "app/client/models/TreeModel";
import { TreeViewComponent } from "app/client/ui/TreeViewComponent";
import { confirmModal } from 'app/client/ui2018/modals';
import { buildPageDom, PageActions } from "app/client/ui2018/pages";
import { mod } from 'app/common/gutil';
import { Computed, Disposable, dom, observable, Observable } from "grainjs";

// build dom for the tree view of pages
export function buildPagesDom(owner: Disposable, activeDoc: GristDoc, isOpen: Observable<boolean>) {
  const pagesTable = activeDoc.docModel.pages;
  const buildDom = buildDomFromTable.bind(null, pagesTable, activeDoc);

  // create the model and keep in sync with the table
  const model = observable(fromTableData(pagesTable.tableData, buildDom));
  owner.autoDispose(pagesTable.tableData.tableActionEmitter.addListener(() => {
    model.set(fromTableData(pagesTable.tableData, buildDom, model.get()));
  }));

  // create a computed that reads the selected page from the url and return the corresponding item
  const selected = Computed.create(owner, activeDoc.activeViewId, (use, viewId) =>
    findInTree(model.get(), (i: TreeItemRecord) => i.record.viewRef === viewId) || null
  );

  owner.autoDispose(createGroup({
    nextPage: () => selected.get() && otherPage(selected.get()!, +1),
    prevPage: () => selected.get() && otherPage(selected.get()!, -1)
  }, null, true));

  // dom
  return dom('div', dom.create(TreeViewComponent, model, {isOpen, selected, isReadonly: activeDoc.isReadonly}));
}

function buildDomFromTable(pagesTable: MetaTableModel<PageRec>, activeDoc: GristDoc, id: number) {
  const {docModel, isReadonly} = activeDoc;
  const pageName = pagesTable.rowModels[id].view.peek().name;
  const viewId = pagesTable.rowModels[id].view.peek().id.peek();
  const docData = pagesTable.tableData.docData;
  const actions: PageActions = {
    onRename: (newName: string) => newName.length && pageName.saveOnly(newName),
    onRemove: () => docData.sendAction(['RemoveRecord', '_grist_Views', viewId]),
    // TODO: duplicate should prompt user for confirmation
    onDuplicate: () => duplicatePage(activeDoc, id),
    isRemoveDisabled: () => false,
    isReadonly
  };

  // find a table with a matching primary view
  const tableRef = docModel.tables.tableData.findRow('primaryViewId', viewId);

  if (tableRef) {
    function doRemove() {
      const tableId = docModel.tables.tableData.getValue(tableRef, 'tableId');
      return docData.sendAction(['RemoveTable', tableId]);
    }

    // if user removes a primary view, let's confirm first, because this will remove the
    // corresponsing table and also all pages that are using this table.
    // TODO: once we have raw table view, removing page should remove just the view (not the
    // table), but for now this is the only way to remove a table in the newui.
    actions.onRemove = () => confirmModal(
      `Delete ${pageName()} data, and remove it from all pages?`, 'Delete', doRemove);

    actions.isRemoveDisabled = () => (docModel.allTables.all().length <= 1);
  }

  const maybeHiddenPageName = Computed.create(activeDoc, (use) => {
    const name = use(pageName);
    if (name === 'GristDocTour' && !activeDoc.showDocTourTable) {
      return '';
    }
    return name;
  });

  return buildPageDom(maybeHiddenPageName, actions, urlState().setLinkUrl({docPage: viewId}));
}

// Select another page in cyclic ordering of pages. Order is downard if given a positive `delta`,
// upward otherwise.
function otherPage(currentPage: TreeItemRecord, delta: number) {
  const records = currentPage.storage.records;
  const index = mod(currentPage.index + delta, records.length);
  const docPage = records[index].viewRef;
  return urlState().pushUrl({docPage});
}
