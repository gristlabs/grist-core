import {GristDoc} from 'app/client/components/GristDoc';
import {copyToClipboard} from 'app/client/lib/copyToClipboard';
import {localStorageObs} from 'app/client/lib/localStorageObs';
import {setTestState} from 'app/client/lib/testState';
import {TableRec} from 'app/client/models/DocModel';
import {docListHeader, docMenuTrigger} from 'app/client/ui/DocMenuCss';
import {showTransientTooltip} from 'app/client/ui/tooltips';
import {buttonSelect, cssButtonSelect} from 'app/client/ui2018/buttonSelect';
import * as css from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {menu, menuItem, menuText} from 'app/client/ui2018/menus';
import {confirmModal} from 'app/client/ui2018/modals';
import {Disposable, dom, fromKo, makeTestId, MultiHolder, styled} from 'grainjs';

const testId = makeTestId('test-raw-data-');

export class DataTables extends Disposable {
  constructor(private _gristDoc: GristDoc) {
    super();
  }

  public buildDom() {
    const holder = new MultiHolder();
    // Get the user id, to remember selected layout on the next visit.
    const userId = this._gristDoc.app.topAppModel.appObs.get()?.currentUser?.id ?? 0;
    const view = holder.autoDispose(localStorageObs(`u=${userId}:raw:viewType`, "list"));
    return container(
      dom.autoDispose(holder),
      cssTableList(
        /***************  List section **********/
        testId('list'),
        cssBetween(
          docListHeader('Raw data tables'),
          cssSwitch(
            buttonSelect<any>(
              view,
              [
                {value: 'card', icon: 'TypeTable'},
                {value: 'list', icon: 'TypeCardList'},
              ],
              css.testId('view-mode'),
              cssButtonSelect.cls("-light")
            )
          )
        ),
        cssList(
          cssList.cls(use => `-${use(view)}`),
          dom.forEach(fromKo(this._gristDoc.docModel.allTables.getObservable()), tableRec =>
            cssItem(
              testId('table'),
              cssItemContent(
                cssIcon('TypeTable'),
                cssLabels(
                  cssTitleLine(
                    cssLine(
                      dom.text(use2 => use2(use2(tableRec.rawViewSection).title) || use2(tableRec.tableId)),
                      testId('table-title'),
                    )
                  ),
                  cssIdLine(
                    cssIdLineContent(
                      cssUpperCase("Table id: "),
                      cssTableId(
                        testId('table-id'),
                        dom.text(tableRec.tableId),
                      ),
                      { title : 'Click to copy' },
                      dom.on('click', async (e, t) => {
                        e.stopImmediatePropagation();
                        e.preventDefault();
                        showTransientTooltip(t, 'Table id copied to clipboard', {
                          key: 'copy-table-id'
                        });
                        await copyToClipboard(tableRec.tableId.peek());
                        setTestState({clipboard: tableRec.tableId.peek()});
                      })
                    )
                  ),
                ),
              ),
              cssDots(docMenuTrigger(
                testId('table-dots'),
                icon('Dots'),
                menu(() => this._menuItems(tableRec), {placement: 'bottom-start'}),
                dom.on('click', (ev) => { ev.stopPropagation(); ev.preventDefault(); }),
              )),
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

  private _menuItems(t: TableRec) {
    const {isReadonly, docModel} = this._gristDoc;
    return [
      // TODO: in the upcoming diff
      // menuItem(() => this._renameTable(t), "Rename", testId('rename'),
      //       dom.cls('disabled', isReadonly)),
      menuItem(
        () => this._removeTable(t),
        'Remove',
        testId('menu-remove'),
        dom.cls('disabled', use => use(isReadonly) || use(docModel.allTables.getObservable()).length <= 1 )
      ),
      dom.maybe(isReadonly, () => menuText('You do not have edit access to this document')),
    ];
  }

  private _removeTable(t: TableRec) {
    const {docModel} = this._gristDoc;
    function doRemove() {
      return docModel.docData.sendAction(['RemoveTable', t.tableId.peek()]);
    }
    confirmModal(`Delete ${t.tableId()} data, and remove it from all pages?`, 'Delete', doRemove);
  }

  // private async _renameTable(t: TableRec) {
  //   // TODO:
  // }
}

const container = styled('div', `
  overflow-y: auto;
  position: relative;
`);

const cssBetween = styled('div', `
  display: flex;
  justify-content: space-between;
`);

// Below styles makes the list view look like a card view
// on smaller screens.

const cssSwitch = styled('div', `
  @media ${css.mediaXSmall} {
    & {
      display: none;
    }
  }
`);

const cssList = styled('div', `
  display: flex;
  &-list {
    flex-direction: column;
    gap: 8px;
  }
  &-card {
    flex-direction: row;
    flex-wrap: wrap;
    gap: 24px;
  }
  @media ${css.mediaSmall} {
    & {
      gap: 12px !important;
    }
  }
`);

const cssItemContent = styled('div', `
  display: flex;
  flex: 1;
  overflow: hidden;
  .${cssList.className}-list & {
    align-items: center;
  }
  .${cssList.className}-card & {
    align-items: flex-start;
  }
  @media ${css.mediaXSmall} {
    & {
      align-items: flex-start !important;
    }
  }
`);

const cssItem = styled('div', `
  display: flex;
  align-items: center;
  cursor: pointer;
  border-radius: 3px;
  max-width: 750px;
  border: 1px solid ${css.colors.mediumGrey};
  &:hover {
    border-color: ${css.colors.slate};
  }
  .${cssList.className}-list & {
    height: calc(1em * 40/13); /* 40px for 13px font */
  }
  .${cssList.className}-card & {
    width: 300px;
    height: calc(1em * 56/13); /* 56px for 13px font */
  }
  @media ${css.mediaSmall} {
    .${cssList.className}-card & {
      width: calc(50% - 12px);
    }
  }
  @media ${css.mediaXSmall} {
    & {
      width: 100% !important;
      height: calc(1em * 56/13) !important; /* 56px for 13px font */
    }
  }
`);

const cssIcon = styled(icon, `
  --icon-color: ${css.colors.lightGreen};
  margin-left: 12px;
  margin-right: 8px;
  flex: none;
  .${cssList.className}-card & {
    margin-top: 1px;
  }
  @media ${css.mediaXSmall} {
    & {
      margin-top: 1px;
    }
  }
`);

const cssOverflow = styled('div', `
  overflow: hidden;
`);

const cssLabels = styled(cssOverflow, `
  overflow: hidden;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  flex: 1;
`);

const cssLine = styled('span', `
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`);

const cssTitleLine = styled(cssOverflow, `
  display: flex;
  min-width: 50%;
  .${cssList.className}-card & {
    flex-basis: 100%;
  }
  @media ${css.mediaXSmall} {
    & {
      flex-basis: 100% !important;
    }
  }
`);

const cssIdLine = styled(cssOverflow, `
  display: flex;
  min-width: 40%;
  .${cssList.className}-card & {
    flex-basis: 100%;
  }
`);

const cssIdLineContent = styled(cssOverflow, `
  display: flex;
  cursor: default;
  align-items: baseline;
  color: ${css.colors.slate};
  transition: background 0.05s;
  padding: 1px 2px;
  &:hover {
    background: ${css.colors.lightGrey};
  }
  @media ${css.mediaSmall} {
    & {
      padding: 0px 2px !important;
    }
  }
`);

const cssTableId = styled(cssLine, `
  font-size: ${css.vars.smallFontSize};
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

const cssDots = styled('div', `
  flex: none;
  margin-right: 8px;
`);

const cssTableList = styled('div', `
  overflow-y: auto;
  position: relative;
  margin-bottom: 56px;
`);
