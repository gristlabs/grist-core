import {GristDoc} from 'app/client/components/GristDoc';
import {copyToClipboard} from 'app/client/lib/copyToClipboard';
import {setTestState} from 'app/client/lib/testState';
import {TableRec} from 'app/client/models/DocModel';
import {docListHeader, docMenuTrigger} from 'app/client/ui/DocMenuCss';
import {showTransientTooltip} from 'app/client/ui/tooltips';
import {buildTableName} from 'app/client/ui/WidgetTitle';
import * as css from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {loadingDots} from 'app/client/ui2018/loaders';
import {menu, menuItem, menuText} from 'app/client/ui2018/menus';
import {confirmModal} from 'app/client/ui2018/modals';
import {Computed, Disposable, dom, fromKo, makeTestId, Observable, styled} from 'grainjs';

const testId = makeTestId('test-raw-data-');

export class DataTables extends Disposable {
  private _tables: Observable<TableRec[]>;

  private readonly _rowCount = Computed.create(
    this, this._gristDoc.docPageModel.currentDocUsage, (_use, usage) => {
      return usage?.rowCount;
    }
  );

  // TODO: Update this whenever the rest of the UI is internationalized.
  private readonly _rowCountFormatter = new Intl.NumberFormat('en-US');

  constructor(private _gristDoc: GristDoc) {
    super();
    this._tables = Computed.create(this, use => {
      const dataTables = use(_gristDoc.docModel.rawDataTables.getObservable());
      const summaryTables = use(_gristDoc.docModel.rawSummaryTables.getObservable());
      // Remove tables that we don't have access to. ACL will remove tableId from those tables.
      return [...dataTables, ...summaryTables].filter(t => Boolean(use(t.tableId)));
    });
  }

  public buildDom() {
    return container(
      cssTableList(
        /***************  List section **********/
        testId('list'),
        docListHeader('Raw Data Tables'),
        cssList(
          dom.forEach(this._tables, tableRec =>
            cssItem(
              testId('table'),
              cssLeft(
                dom.domComputed((use) => cssGreenIcon(
                  use(tableRec.summarySourceTable) !== 0 ? 'PivotLight' : 'TypeTable',
                  testId(`table-id-${use(tableRec.tableId)}`)
                )),
              ),
              cssMiddle(
                cssTitleRow(cssTableTitle(this._tableTitle(tableRec), testId('table-title'))),
                cssDetailsRow(
                  cssTableIdWrapper(cssHoverWrapper(
                    cssUpperCase("Table ID: "),
                    cssTableId(
                      testId('table-id'),
                      dom.text(tableRec.tableId),
                    ),
                    { title : 'Click to copy' },
                    dom.on('click', async (e, t) => {
                      e.stopImmediatePropagation();
                      e.preventDefault();
                      showTransientTooltip(t, 'Table ID copied to clipboard', {
                        key: 'copy-table-id'
                      });
                      await copyToClipboard(tableRec.tableId.peek());
                      setTestState({clipboard: tableRec.tableId.peek()});
                    })
                  )),
                  this._tableRows(tableRec),
                ),
              ),
              cssRight(
                docMenuTrigger(
                  testId('table-menu'),
                  icon('Dots'),
                  menu(() => this._menuItems(tableRec), {placement: 'bottom-start'}),
                  dom.on('click', (ev) => { ev.stopPropagation(); ev.preventDefault(); }),
                )
              ),
              dom.on('click', () => {
                const sectionId = tableRec.rawViewSection.peek().getRowId();
                if (!sectionId) {
                  throw new Error(`Table ${tableRec.tableId.peek()} doesn't have a raw view section.`);
                }
                this._gristDoc.viewModel.activeSectionId(sectionId);
              })
            )
          )
        ),
      ),
    );
  }

  private _tableTitle(table: TableRec) {
    return dom.domComputed((use) => {
      const rawViewSectionRef = use(fromKo(table.rawViewSectionRef));
      const isSummaryTable = use(table.summarySourceTable) !== 0;
      if (!rawViewSectionRef || isSummaryTable) {
        // Some very old documents might not have a rawViewSection, and raw summary
        // tables can't currently be renamed.
        const tableName = [
          use(table.tableNameDef), isSummaryTable ? use(table.groupDesc) : ''
        ].filter(p => Boolean(p?.trim())).join(' ');
        return dom('span', tableName);
      } else {
        return dom('div', // to disable flex grow in the widget
          dom.domComputed(fromKo(table.rawViewSection), vs =>
            buildTableName(vs, testId('widget-title'))
          )
        );
      }
    });
  }

  private _menuItems(table: TableRec) {
    const {isReadonly, docModel} = this._gristDoc;
    return [
      menuItem(
        () => this._removeTable(table),
        'Remove',
        testId('menu-remove'),
        dom.cls('disabled', use => use(isReadonly) || (
          // Can't delete last visible table, unless it is a hidden table.
          use(docModel.visibleTables.getObservable()).length <= 1 && !use(table.isHidden)
        ))
      ),
      dom.maybe(isReadonly, () => menuText('You do not have edit access to this document')),
    ];
  }

  private _removeTable(t: TableRec) {
    const {docModel} = this._gristDoc;
    function doRemove() {
      return docModel.docData.sendAction(['RemoveTable', t.tableId()]);
    }
    confirmModal(`Delete ${t.formattedTableName()} data, and remove it from all pages?`, 'Delete', doRemove);
  }

  private _tableRows(table: TableRec) {
    return dom.maybe(this._rowCount, (rowCounts) => {
      if (rowCounts === 'hidden') { return null; }

      return cssTableRowsWrapper(
        cssUpperCase("Rows: "),
        rowCounts === 'pending' ? cssLoadingDots() : cssTableRows(
          rowCounts[table.getRowId()] !== undefined
            ? this._rowCountFormatter.format(rowCounts[table.getRowId()])
            : '',
          testId('table-rows'),
        )
      );
    });
  }
}

const container = styled('div', `
  overflow-y: auto;
  position: relative;
`);

const cssList = styled('div', `
  display: flex;
  flex-direction: column;
  gap: 12px;
`);

const cssItem = styled('div', `
  display: flex;
  align-items: center;
  cursor: pointer;
  border-radius: 3px;
  width: 100%;
  height: calc(1em * 56/13); /* 56px for 13px font */
  max-width: 750px;
  border: 1px solid ${css.colors.mediumGrey};
  &:hover {
    border-color: ${css.colors.slate};
  }
`);

// Holds icon in top left corner
const cssLeft = styled('div', `
  padding-top: 11px;
  padding-left: 12px;
  margin-right: 8px;
  align-self: flex-start;
  display: flex;
  flex: none;
`);

const cssMiddle = styled('div', `
  flex-grow: 1;
  min-width: 0px;
  display: flex;
  flex-wrap: wrap;
  margin-top: 6px;
  margin-bottom: 4px;
`);

const cssTitleRow = styled('div', `
  min-width: 100%;
  margin-right: 4px;
`);

const cssDetailsRow = styled('div', `
  min-width: 100%;
  display: flex;
  gap: 8px;
`);


// Holds dots menu (which is 24px x 24px, but has its own 4px right margin)
const cssRight = styled('div', `
  padding-right: 8px;
  margin-left: 8px;
  align-self: center;
  display: flex;
  flex: none;
`);

const cssGreenIcon = styled(icon, `
  --icon-color: ${css.colors.lightGreen};
`);

const cssLine = styled('span', `
  white-space: nowrap;
  text-overflow: ellipsis;
  overflow: hidden;
`);

const cssTableIdWrapper = styled('div', `
  display: flex;
  flex-grow: 1;
  min-width: 0;
`);

const cssTableRowsWrapper = styled('div', `
  display: flex;
  flex-shrink: 0;
  width: 80px;
  overflow: hidden;
  align-items: baseline;
  color: ${css.colors.slate};
  line-height: 18px;
  padding: 0px 2px;
`);

const cssHoverWrapper = styled('div', `
  display: flex;
  overflow: hidden;
  cursor: default;
  align-items: baseline;
  color: ${css.colors.slate};
  transition: background 0.05s;
  padding: 0px 2px;
  line-height: 18px;
  &:hover {
    background: ${css.colors.lightGrey};
  }
`);

const cssTableId = styled(cssLine, `
  font-size: ${css.vars.smallFontSize};
`);

const cssTableRows = cssTableId;

const cssTableTitle = styled('div', `
  white-space: nowrap;
`);

const cssUpperCase = styled('span', `
  text-transform: uppercase;
  letter-spacing: 0.81px;
  font-weight: 500;
  font-size: 9px; /* xxsmallFontSize is to small */
  margin-right: 2px;
  flex: 0;
  white-space: nowrap;
`);

const cssTableList = styled('div', `
  overflow-y: auto;
  position: relative;
  margin-bottom: 56px;
`);

const cssLoadingDots = styled(loadingDots, `
  --dot-size: 6px;
`);
