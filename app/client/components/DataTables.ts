import * as commands from 'app/client/components/commands';
import {GristDoc} from 'app/client/components/GristDoc';
import {copyToClipboard} from 'app/client/lib/clipboardUtils';
import {setTestState} from 'app/client/lib/testState';
import {TableRec} from 'app/client/models/DocModel';
import {docListHeader, docMenuTrigger} from 'app/client/ui/DocMenuCss';
import {duplicateTable, DuplicateTableResponse} from 'app/client/ui/DuplicateTable';
import {hoverTooltip, showTransientTooltip} from 'app/client/ui/tooltips';
import {buildTableName} from 'app/client/ui/WidgetTitle';
import * as css from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {loadingDots} from 'app/client/ui2018/loaders';
import {menu, menuDivider, menuIcon, menuItem, menuItemAsync, menuText} from 'app/client/ui2018/menus';
import {confirmModal} from 'app/client/ui2018/modals';
import {Computed, Disposable, dom, fromKo, makeTestId, observable, Observable, styled} from 'grainjs';
import {makeT} from 'app/client/lib/localization';
import * as weasel from 'popweasel';

const testId = makeTestId('test-raw-data-');

const t = makeT('DataTables');

const DATA_TABLES_TOOLTIP_KEY = 'dataTablesTooltip';

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
      return [...dataTables, ...summaryTables].filter(table => Boolean(use(table.tableId)));
    });
  }

  public buildDom() {
    return container(
      cssTableList(
        /***************  List section **********/
        testId('list'),
        cssHeader(t("Raw Data Tables")),
        cssList(
          dom.forEach(this._tables, tableRec => {
            const isEditingName = observable(false);
            return cssTable(
              dom.autoDispose(isEditingName),
              testId('table'),
              cssTableIcon(
                dom.domComputed((use) => cssTableTypeIcon(
                  use(tableRec.summarySourceTable) !== 0 ? 'PivotLight' : 'TypeTable',
                  testId(`table-id-${use(tableRec.tableId)}`)
                )),
              ),
              cssTableNameAndId(
                cssTitleRow(cssTableTitle(this._tableTitle(tableRec, isEditingName), testId('table-title'))),
                cssDetailsRow(
                  cssTableIdWrapper(cssHoverWrapper(
                    cssUpperCase("Table ID: "),
                    cssTableId(
                      testId('table-id'),
                      dom.text(tableRec.tableId),
                    ),
                    { title : t("Click to copy") },
                    dom.on('click', async (e, d) => {
                      e.stopImmediatePropagation();
                      e.preventDefault();
                      showTransientTooltip(d, t("Table ID copied to clipboard"), {
                        key: 'copy-table-id'
                      });
                      await copyToClipboard(tableRec.tableId.peek());
                      setTestState({clipboard: tableRec.tableId.peek()});
                    })
                  )),
                ),
              ),
              this._tableRows(tableRec),
              cssTableButtons(
                cssRecordCardButton(
                  icon('TypeCard'),
                  dom.on('click', (ev) => {
                    ev.stopPropagation();
                    ev.preventDefault();
                    if (!tableRec.recordCardViewSection().disabled()) {
                      this._editRecordCard(tableRec);
                    }
                  }),
                  hoverTooltip(
                    dom.domComputed(use => use(use(tableRec.recordCardViewSection).disabled)
                      ? t('Record Card Disabled')
                      : t('Edit Record Card')),
                    {key: DATA_TABLES_TOOLTIP_KEY, closeOnClick: false}
                  ),
                  dom.hide(this._gristDoc.isReadonly),
                  // Make the button invisible to maintain consistent alignment with non-summary tables.
                  dom.style('visibility', u => u(tableRec.summarySourceTable) === 0 ? 'visible' : 'hidden'),
                  cssRecordCardButton.cls('-disabled', use => use(use(tableRec.recordCardViewSection).disabled)),
                  testId('table-record-card'),
                ),
                cssDotsButton(
                  testId('table-menu'),
                  icon('Dots'),
                  menu(() => this._menuItems(tableRec, isEditingName), {placement: 'bottom-start'}),
                  dom.on('click', (ev) => { ev.stopPropagation(); ev.preventDefault(); }),
                )
              ),
              dom.on('click', () => {
                const sectionId = tableRec.rawViewSection.peek().getRowId();
                if (!sectionId) {
                  throw new Error(`Table ${tableRec.tableId.peek()} doesn't have a raw view section.`);
                }
                this._gristDoc.viewModel.activeSectionId(sectionId);
              }),
              cssTable.cls('-readonly', this._gristDoc.isReadonly),
            );
          })
        ),
      ),
    );
  }

  private _tableTitle(table: TableRec, isEditing: Observable<boolean>) {
    return dom.domComputed((use) => {
      const rawViewSectionRef = use(fromKo(table.rawViewSectionRef));
      const isSummaryTable = use(table.summarySourceTable) !== 0;
      const isReadonly = use(this._gristDoc.isReadonly);
      if (!rawViewSectionRef || isSummaryTable || isReadonly) {
        // Some very old documents might not have a rawViewSection, and raw summary
        // tables can't currently be renamed.
        const tableName = [
          use(table.tableNameDef), isSummaryTable ? use(table.groupDesc) : ''
        ].filter(p => Boolean(p?.trim())).join(' ');
        return cssTableName(tableName);
      } else {
        return cssFlexRow(
          dom.domComputed(fromKo(table.rawViewSection), vs =>
            buildTableName(vs, {isEditing}, cssRenamableTableName.cls(''), testId('widget-title'))
          ),
          cssRenameTableButton(icon('Pencil'),
            dom.on('click', (ev) => {
              ev.stopPropagation();
              ev.preventDefault();
              isEditing.set(true);
            }),
            cssRenameTableButton.cls('-active', isEditing),
          ),
        );
      }
    });
  }

  private _menuItems(table: TableRec, isEditingName: Observable<boolean>) {
    const {isReadonly, docModel} = this._gristDoc;
    return [
      menuItem(
        () => { isEditingName.set(true); },
        t("Rename Table"),
        dom.cls('disabled', use => use(isReadonly) || use(table.summarySourceTable) !== 0),
        testId('menu-rename-table'),
      ),
      menuItem(
        () => this._duplicateTable(table),
        t("Duplicate Table"),
        dom.cls('disabled', use =>
          use(isReadonly) ||
          use(table.isHidden) ||
          use(table.summarySourceTable) !== 0
        ),
        testId('menu-duplicate-table'),
      ),
      menuItem(
        () => this._removeTable(table),
        t("Remove Table"),
        dom.cls('disabled', use => use(isReadonly) || (
          // Can't delete last visible table, unless it is a hidden table.
          use(docModel.visibleTables.getObservable()).length <= 1 && !use(table.isHidden)
        )),
        testId('menu-remove-table'),
      ),
      dom.maybe(use => use(table.summarySourceTable) === 0, () => [
        menuDivider(),
        menuItem(
          () => this._editRecordCard(table),
          cssMenuItemIcon('TypeCard'),
          t("Edit Record Card"),
          dom.cls('disabled', use => use(isReadonly)),
          testId('menu-edit-record-card'),
        ),
        dom.domComputed(use => use(use(table.recordCardViewSection).disabled), (isDisabled) => {
          return menuItemAsync(
            async () => {
              if (isDisabled) {
                await this._enableRecordCard(table);
              } else {
                await this._disableRecordCard(table);
              }
            },
            t('{{action}} Record Card', {action: isDisabled ? 'Enable' : 'Disable'}),
            dom.cls('disabled', use => use(isReadonly)),
            testId(`menu-${isDisabled ? 'enable' : 'disable'}-record-card`),
          );
        }),
      ]),
      dom.maybe(isReadonly, () => menuText(t("You do not have edit access to this document"))),
    ];
  }

  private _duplicateTable(r: TableRec) {
    duplicateTable(this._gristDoc, r.tableId(), {
      onSuccess: ({raw_section_id}: DuplicateTableResponse) =>
        this._gristDoc.viewModel.activeSectionId(raw_section_id),
    });
  }

  private _removeTable(r: TableRec) {
    const {docModel} = this._gristDoc;
    function doRemove() {
      return docModel.docData.sendAction(['RemoveTable', r.tableId()]);
    }
    confirmModal(t(
      "Delete {{formattedTableName}} data, and remove it from all pages?",
      {formattedTableName : r.formattedTableName()}
    ), 'Delete', doRemove);
  }

  private _editRecordCard(r: TableRec) {
    const sectionId = r.recordCardViewSection.peek().getRowId();
    if (!sectionId) {
      throw new Error(`Table ${r.tableId.peek()} doesn't have a record card view section.`);
    }

    this._gristDoc.viewModel.activeSectionId(sectionId);
    commands.allCommands.editLayout.run();
  }

  private async _enableRecordCard(r: TableRec) {
    await r.recordCardViewSection().disabled.setAndSave(false);
  }

  private async _disableRecordCard(r: TableRec) {
    await r.recordCardViewSection().disabled.setAndSave(true);
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

const cssMenuItemIcon = styled(menuIcon, `
  --icon-color: ${css.theme.menuItemFg};

  .${weasel.cssMenuItem.className}-sel & {
    --icon-color: ${css.theme.menuItemSelectedFg};
  }

  .${weasel.cssMenuItem.className}.disabled & {
    --icon-color: ${css.theme.menuItemDisabledFg};
  }
`);

const container = styled('div', `
  overflow-y: auto;
  position: relative;
`);

const cssHeader = styled(docListHeader, `
  display: inline-block;
`);

const cssList = styled('div', `
  display: flex;
  flex-direction: column;
  gap: 12px;
`);

const cssTable = styled('div', `
  display: grid;
  grid-template-columns: 16px minmax(32px, auto) minmax(0, 100px) minmax(0, 56px);
  grid-template-rows: 1fr;
  grid-column-gap: 8px;
  cursor: pointer;
  border-radius: 3px;
  width: 100%;
  height: calc(1em * 56/13); /* 56px for 13px font */
  max-width: 750px;
  padding: 0px 12px 0px 12px;
  border: 1px solid ${css.theme.rawDataTableBorder};
  &:hover {
    border-color: ${css.theme.rawDataTableBorderHover};
  }
  &-readonly {
    /* Row count column is hidden when document is read-only. */
    grid-template-columns: 16px auto 56px;
  }
`);

const cssTableIcon = styled('div', `
  padding-top: 11px;
  display: flex;
`);

const cssTableNameAndId = styled('div', `
  min-width: 0px;
  display: flex;
  flex-direction: column;
  margin-top: 8px;
`);

const cssTitleRow = styled('div', `
  min-width: 100%;
`);

const cssDetailsRow = styled('div', `
  min-width: 100%;
  display: flex;
  gap: 8px;
`);


// Holds dots menu (which is 24px x 24px)
const cssTableButtons = styled('div', `
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  column-gap: 8px;
`);

const cssTableTypeIcon = styled(icon, `
  --icon-color: ${css.theme.accentIcon};
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
  overflow: hidden;
  align-items: center;
  color: ${css.theme.lightText};
  line-height: 18px;
`);

const cssHoverWrapper = styled('div', `
  display: flex;
  overflow: hidden;
  cursor: default;
  align-items: baseline;
  color: ${css.theme.lightText};
  transition: background 0.05s;
  padding: 0px 2px;
  line-height: 18px;
  &:hover {
    background: ${css.theme.lightHover};
  }
`);

const cssTableId = styled(cssLine, `
  font-size: ${css.vars.smallFontSize};
`);

const cssTableRows = cssTableId;

const cssTableTitle = styled('div', `
  color: ${css.theme.text};
  overflow: hidden;
  text-overflow: ellipsis;
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

const cssTableName = styled('span', `
  color: ${css.theme.text};
`);

const cssRecordCardButton = styled('div', `
  display: flex;
  align-items: center;
  justify-content: center;
  height: 24px;
  width: 24px;
  cursor: default;
  padding: 4px;
  border-radius: 3px;
  --icon-color: ${css.theme.lightText};

  &:hover {
    background-color: ${css.theme.hover};
    --icon-color: ${css.theme.controlFg};
  }

  &-disabled {
    --icon-color: ${css.theme.lightText};
    padding: 0px;
    opacity: 0.4;
  }

  &-disabled:hover {
    background: none;
    --icon-color: ${css.theme.lightText};
  }
`);

const cssDotsButton = styled(docMenuTrigger, `
  margin: 0px;

  &:hover, &.weasel-popup-open {
    background-color: ${css.theme.hover};
  }
`);

const cssRenameTableButton = styled('div', `
  flex-shrink: 0;
  width: 16px;
  visibility: hidden;
  cursor: default;
  --icon-color: ${css.theme.lightText};
  &:hover  {
    --icon-color: ${css.theme.controlFg};
  }
  &-active  {
    visibility: hidden;
  }
  .${cssTableTitle.className}:hover & {
    visibility: visible;
  }
`);

const cssFlexRow = styled('div', `
  display: flex;
  align-items: center;
  column-gap: 8px;
`);

const cssRenamableTableName = styled('div', `
  align-items: center;
  flex: initial;
`);
