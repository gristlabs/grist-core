import {createGroup} from 'app/client/components/commands';
import {duplicatePage} from 'app/client/components/duplicatePage';
import {GristDoc} from 'app/client/components/GristDoc';
import {makeT} from 'app/client/lib/localization';
import {logTelemetryEvent} from 'app/client/lib/telemetry';
import {PageRec} from 'app/client/models/DocModel';
import {urlState} from 'app/client/models/gristUrlState';
import MetaTableModel from 'app/client/models/MetaTableModel';
import {find as findInTree, fromTableData, TreeItemRecord, TreeRecord,
        TreeTableData} from 'app/client/models/TreeModel';
import {TreeViewComponent} from 'app/client/ui/TreeViewComponent';
import {cssRadioCheckboxOptions, radioCheckboxOption} from 'app/client/ui2018/checkbox';
import {theme} from 'app/client/ui2018/cssVars';
import {cssLink} from 'app/client/ui2018/links';
import {ISaveModalOptions, saveModal} from 'app/client/ui2018/modals';
import {buildCensoredPage, buildPageDom, PageActions} from 'app/client/ui2018/pages';
import {mod} from 'app/common/gutil';
import {Computed, Disposable, dom, fromKo, makeTestId, observable, Observable, styled} from 'grainjs';

const t = makeT('Pages');

// build dom for the tree view of pages
export function buildPagesDom(owner: Disposable, activeDoc: GristDoc, isOpen: Observable<boolean>) {
  const pagesTable = activeDoc.docModel.pages;
  const buildDom = buildDomFromTable.bind(null, pagesTable, activeDoc);

  const records = Computed.create<TreeRecord[]>(owner, (use) =>
    use(activeDoc.docModel.menuPages).map(page => ({
      id: page.getRowId(),
      indentation: use(page.indentation),
      pagePos: use(page.pagePos),
      viewRef: use(page.viewRef),
      hidden: use(page.isCensored),
    }))
  );
  const getTreeTableData = (): TreeTableData => ({
    getRecords: () => records.get(),
    sendTableActions: (...args) => pagesTable.tableData.sendTableActions(...args),
  });

  // create the model and keep in sync with the table
  const model = observable(fromTableData(getTreeTableData(), buildDom));
  owner.autoDispose(records.addListener(() => {
    model.set(fromTableData(getTreeTableData(), buildDom, model.get()));
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

const testId = makeTestId('test-removepage-');

function buildDomFromTable(pagesTable: MetaTableModel<PageRec>, activeDoc: GristDoc, pageId: number, hidden: boolean) {

  if (hidden) {
    return buildCensoredPage();
  }

  const {isReadonly} = activeDoc;
  const pageName = pagesTable.rowModels[pageId].view.peek().name;
  const viewId = pagesTable.rowModels[pageId].view.peek().id.peek();

  const actions: PageActions = {
    onRename: (newName: string) => newName.length && pageName.saveOnly(newName),
    onRemove: () => removeView(activeDoc, viewId, pageName.peek()),
    // TODO: duplicate should prompt user for confirmation
    onDuplicate: () => duplicatePage(activeDoc, pageId),
    // Can't remove last visible page
    isRemoveDisabled: () => activeDoc.docModel.visibleDocPages.peek().length <= 1,
    isReadonly
  };

  return buildPageDom(fromKo(pageName), actions, urlState().setLinkUrl({docPage: viewId}));
}

function removeView(activeDoc: GristDoc, viewId: number, pageName: string) {
  logTelemetryEvent('deletedPage', {full: {docIdDigest: activeDoc.docId()}});

  const docData = activeDoc.docData;
  // Create a set with tables on other pages (but not on this one).
  const tablesOnOtherViews = new Set(activeDoc.docModel.viewSections.rowModels
    .filter(vs => !vs.isRaw.peek() && !vs.isRecordCard.peek() && vs.parentId.peek() !== viewId)
    .map(vs => vs.tableRef.peek()));

  // Check if this page is a last page for some tables.
  const notVisibleTables = [...new Set(activeDoc.docModel.viewSections.rowModels
    .filter(vs => vs.parentId.peek() === viewId) // Get all sections on this view
    .filter(vs => !vs.table.peek().summarySourceTable.peek()) // Sections that have normal tables
    .filter(vs => !tablesOnOtherViews.has(vs.tableRef.peek())) // That aren't on other views
    .filter(vs => vs.table.peek().tableId.peek()) // Which we can access (has tableId)
    .map(vs => vs.table.peek()))]; // Return tableRec object, and remove duplicates.

  const removePage = () => [['RemoveRecord', '_grist_Views', viewId]];
  const removeAll = () => [
    ...removePage(),
    ...notVisibleTables.map(tb => ['RemoveTable', tb.tableId.peek()])
  ];

  if (notVisibleTables.length) {
    const tableNames = notVisibleTables.map(tb => tb.tableNameDef.peek());
    buildPrompt(tableNames, async (option) => {
      // Errors are handled in the dialog.
      if (option === 'data') {
        await docData.sendActions(removeAll(), `Remove page ${pageName} with tables ${tableNames}`);
      } else if (option === 'page') {
        await docData.sendActions(removePage(), `Remove only page ${pageName}`);
      } else {
        // This should not happen, as save should be disabled when no option is selected.
      }
    });
  } else {
    return docData.sendActions(removePage(), `Remove only page ${pageName}`);
  }
}

type RemoveOption = '' | 'data' | 'page';

// Select another page in cyclic ordering of pages. Order is downard if given a positive `delta`,
// upward otherwise.
function otherPage(currentPage: TreeItemRecord, delta: number) {
  const records = currentPage.storage.records;
  const index = mod(currentPage.index + delta, records.length);
  const docPage = records[index].viewRef;
  return urlState().pushUrl({docPage});
}

function buildPrompt(tableNames: string[], onSave: (option: RemoveOption) => Promise<any>) {
  saveModal((ctl, owner): ISaveModalOptions => {
    const selected = Observable.create<RemoveOption>(owner, '');
    const saveDisabled = Computed.create(owner, use => use(selected) === '');
    const saveFunc = () => onSave(selected.get());
    return {
      title: t('The following tables will no longer be visible', { count: tableNames.length }),
      body: dom('div',
        testId('popup'),
        buildWarning(tableNames),
        cssRadioCheckboxOptions(
          radioCheckboxOption(selected, 'data', t("Delete data and this page.")),
          radioCheckboxOption(selected, 'page',
            [ // TODO i18n
              `Keep data and delete page. `,
              `Table will remain available in `,
              cssLink(urlState().setHref({docPage: 'data'}), 'raw data page', { target: '_blank'}),
              `.`
            ]),
        )
      ),
      saveDisabled,
      saveLabel: t("Delete"),
      saveFunc,
      width: 'fixed-wide',
      extraButtons: [],
    };
  });
}


function buildWarning(tables: string[]) {
  return cssWarning(
    dom.forEach(tables, (tb) => cssTableName(tb, testId('table')))
  );
}

const cssWarning = styled('div', `
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 16px;
`);

const cssTableName = styled('div', `
  color: ${theme.choiceTokenFg};
  background-color: ${theme.choiceTokenBg};
  padding: 3px 6px;
  border-radius: 4px;
`);
