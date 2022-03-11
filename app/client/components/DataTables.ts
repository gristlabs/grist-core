import * as commands from 'app/client/components/commands';
import {GristDoc} from 'app/client/components/GristDoc';
import {printViewSection} from 'app/client/components/Printing';
import {buildViewSectionDom, ViewSectionHelper} from 'app/client/components/ViewLayout';
import {copyToClipboard} from 'app/client/lib/copyToClipboard';
import {localStorageObs} from 'app/client/lib/localStorageObs';
import {setTestState} from 'app/client/lib/testState';
import {TableRec} from 'app/client/models/DocModel';
import {reportError} from 'app/client/models/errors';
import {docList, docListHeader, docMenuTrigger} from 'app/client/ui/DocMenuCss';
import {showTransientTooltip} from 'app/client/ui/tooltips';
import {buttonSelect, cssButtonSelect} from 'app/client/ui2018/buttonSelect';
import * as css from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {menu, menuItem, menuText} from 'app/client/ui2018/menus';
import {confirmModal} from 'app/client/ui2018/modals';
import {Computed, Disposable, dom, fromKo, makeTestId, MultiHolder, styled} from 'grainjs';

const testId = makeTestId('test-raw-data-');

export class DataTables extends Disposable {
  private _popupVisible = Computed.create(this, use => Boolean(use(this._gristDoc.viewModel.activeSectionId)));

  constructor(private _gristDoc: GristDoc) {
    super();
    const commandGroup = {
      cancel: () => { this._close(); },
      printSection: () => { printViewSection(null, this._gristDoc.viewModel.activeSection()).catch(reportError); },
    };
    this.autoDispose(commands.createGroup(commandGroup, this, true));
  }

  public buildDom() {
    const holder = new MultiHolder();
    // Get the user id, to remember selected layout on the next visit.
    const userId = this._gristDoc.app.topAppModel.appObs.get()?.currentUser?.id ?? 0;
    const view = holder.autoDispose(localStorageObs(`u=${userId}:raw:viewType`, "list"));
    // Handler to close the lightbox.
    const close = this._close.bind(this);
    return container(
      dom.autoDispose(holder),
      docList(
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
      /***************  Lightbox section **********/
      container.cls("-lightbox", this._popupVisible),
      dom.domComputedOwned(fromKo(this._gristDoc.viewModel.activeSection), (owner, viewSection) => {
        if (!viewSection.getRowId()) {
          return null;
        }
        ViewSectionHelper.create(owner, this._gristDoc, viewSection);
        return cssOverlay(
          testId('overlay'),
          cssSectionWrapper(
            buildViewSectionDom({
              gristDoc: this._gristDoc,
              sectionRowId: viewSection.getRowId(),
              draggable: false,
              focusable: false,
              onRename: this._renameSection.bind(this)
            })
          ),
          cssCloseButton('CrossBig',
            testId('close-button'),
            dom.on('click', close)
          ),
          // Close the lightbox when user clicks exactly on the overlay.
          dom.on('click', (ev, elem) => void (ev.target === elem ? close() : null))
        );
      }),
    );
  }

  private _close() {
    this._gristDoc.viewModel.activeSectionId(0);
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

  private async _renameSection(name: string) {
    // here we will rename primary page for active primary viewSection
    const primaryViewName = this._gristDoc.viewModel.activeSection.peek().table.peek().primaryView.peek().name;
    await primaryViewName.saveOnly(name);
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
  overflow: hidden;
  position: relative;
  height: 100%;
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

const cssOverlay = styled('div', `
  z-index: 10;
  background-color: ${css.colors.backdrop};
  inset: 0px;
  height: 100%;
  width: 100%;
  padding: 32px 56px 0px 56px;
  position: absolute;
  @media ${css.mediaSmall} {
    & {
      padding: 22px;
      padding-top: 30px;
    }
  }
`);

const cssSectionWrapper = styled('div', `
  background: white;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: 5px;
  border-bottom-left-radius: 0px;
  border-bottom-right-radius: 0px;
  & .viewsection_content {
    margin: 0px;
    margin-top: 12px;
  }
  & .viewsection_title {
    padding: 0px 12px;
  }
  & .filter_bar {
    margin-left: 6px;
  }
`);

const cssCloseButton = styled(icon, `
  position: absolute;
  top: 16px;
  right: 16px;
  height: 24px;
  width: 24px;
  cursor: pointer;
  --icon-color: ${css.vars.primaryBg};
  &:hover {
    --icon-color: ${css.colors.lighterGreen};
  }
  @media ${css.mediaSmall} {
    & {
      top: 6px;
      right: 6px;
    }
  }
`);
