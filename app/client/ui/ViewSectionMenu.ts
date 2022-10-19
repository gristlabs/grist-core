import {reportError} from 'app/client/models/AppModel';
import {ColumnRec, DocModel, ViewSectionRec} from 'app/client/models/DocModel';
import {FilterInfo} from 'app/client/models/entities/ViewSectionRec';
import {CustomComputed} from 'app/client/models/modelUtil';
import {attachColumnFilterMenu} from 'app/client/ui/ColumnFilterMenu';
import {addFilterMenu} from 'app/client/ui/FilterBar';
import {hoverTooltip} from 'app/client/ui/tooltips';
import {makeViewLayoutMenu} from 'app/client/ui/ViewLayoutMenu';
import {basicButton, primaryButton} from 'app/client/ui2018/buttons';
import {theme, vars} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {menu} from 'app/client/ui2018/menus';
import {Sort} from 'app/common/SortSpec';
import {Computed, dom, fromKo, IDisposableOwner, makeTestId, Observable, styled} from 'grainjs';
import {PopupControl} from 'popweasel';
import difference = require('lodash/difference');

const testId = makeTestId('test-section-menu-');

// Handler for [Save] button.
async function doSave(docModel: DocModel, viewSection: ViewSectionRec): Promise<void> {
  await docModel.docData.bundleActions("Update Sort&Filter settings", () => Promise.all([
    viewSection.activeSortJson.save(),      // Save sort
    viewSection.saveFilters(),              // Save filter
    viewSection.activeFilterBar.save(),     // Save bar
    viewSection.activeCustomOptions.save(), // Save widget options
  ]));
}

// Handler for [Revert] button.
function doRevert(viewSection: ViewSectionRec) {
  viewSection.activeSortJson.revert();      // Revert sort
  viewSection.revertFilters();              // Revert filter
  viewSection.activeFilterBar.revert();     // Revert bar
  viewSection.activeCustomOptions.revert(); // Revert widget options
}

// [Filter Icon] (v) (x) - Filter toggle and all the components in the menu.
export function viewSectionMenu(owner: IDisposableOwner, docModel: DocModel, viewSection: ViewSectionRec,
                                isReadonly: Observable<boolean>) {

  const popupControls = new WeakMap<ColumnRec, PopupControl>();

  // If there is any filter (should [Filter Icon] be green).
  const anyFilter = Computed.create(owner, (use) => Boolean(use(viewSection.activeFilters).length));

  // Should border be green, and should we show [Save] [Revert] (v) (x) buttons.
  const displaySaveObs: Computed<boolean> = Computed.create(owner, (use) => (
    use(viewSection.filterSpecChanged)
      || !use(viewSection.activeSortJson.isSaved)
      || !use(viewSection.activeFilterBar.isSaved)
      || !use(viewSection.activeCustomOptions.isSaved)
  ));

  const save = () => { doSave(docModel, viewSection).catch(reportError); };
  const revert = () => doRevert(viewSection);

  return [
    cssFilterMenuWrapper(
      cssFixHeight.cls(''),
      cssFilterMenuWrapper.cls('-unsaved', displaySaveObs),
      testId('wrapper'),
      cssMenu(
        testId('sortAndFilter'),
        // [Filter icon] grey or green
        cssFilterIconWrapper(
          testId('filter-icon'),
          // Make green when there are some filters. If there are only sort options, leave grey.
          cssFilterIconWrapper.cls('-any', anyFilter),
          cssFilterIcon('Filter'),
          hoverTooltip('Sort and filter', {key: 'sortFilterBtnTooltip'}),
        ),
        menu(ctl => [
          // Sorted by section.
          dom.domComputed(use => {
            use(viewSection.activeSortJson.isSaved); // Rebuild sort panel if sort gets saved. A little hacky.
            return makeSortPanel(viewSection, use(viewSection.activeSortSpec),
                                 (row: number) => docModel.columns.getRowModel(row));
          }),
          // Filtered by section.
          dom.domComputed(viewSection.activeFilters, filters =>
                          makeFilterPanel(viewSection, filters, popupControls, () => ctl.close())),
          // [+] Add filter
          makeAddFilterButton(viewSection, popupControls),
          // [+] Toggle filter bar
          dom.maybe((use) => !use(viewSection.isRaw),
            () => makeFilterBarToggle(viewSection.activeFilterBar)),
          // Widget options
          dom.maybe(use => use(viewSection.parentKey) === 'custom', () =>
            makeCustomOptions(viewSection)
          ),
          // [Save] [Revert] buttons
          dom.domComputed(displaySaveObs, displaySave => [
            displaySave ? cssMenuInfoHeader(
              cssSaveButton('Save', testId('btn-save'),
                            dom.on('click', () => { save(); ctl.close(); }),
                            dom.boolAttr('disabled', isReadonly)),
              basicButton('Revert', testId('btn-revert'),
                          dom.on('click', () => { revert(); ctl.close(); }))
            ) : null,
          ]),
        ]),
      ),
      // Two icons (v) (x) left to the toggle, when there are unsaved filters or sort options.
      // Those buttons are equivalent of the [Save] [Revert] buttons in the menu.
      dom.maybe(displaySaveObs, () => cssSaveIconsWrapper(
        // (v)
        cssSmallIconWrapper(
          cssIcon('Tick'), cssSmallIconWrapper.cls('-green'),
          dom.on('click', save),
          hoverTooltip('Save sort & filter settings', {key: 'sortFilterBtnTooltip'}),
          testId('small-btn-save'),
          dom.hide(isReadonly),
        ),
        // (x)
        cssSmallIconWrapper(
          cssIcon('CrossSmall'), cssSmallIconWrapper.cls('-gray'),
          dom.on('click', revert),
          hoverTooltip('Revert sort & filter settings', {key: 'sortFilterBtnTooltip'}),
          testId('small-btn-revert'),
        ),
      )),
    ),
    cssMenu(
      testId('viewLayout'),
      cssFixHeight.cls(''),
      cssDotsIconWrapper(cssIcon('Dots')),
      menu(_ctl => makeViewLayoutMenu(viewSection, isReadonly.get()))
    )
  ];
}

// Sorted by section (and all columns underneath or (Default) label).
function makeSortPanel(section: ViewSectionRec, sortSpec: Sort.SortSpec, getColumn: (row: number) => ColumnRec) {
  const changedColumns = difference(sortSpec, Sort.parseSortColRefs(section.sortColRefs.peek()));
  const sortColumns = sortSpec.map(colSpec => {
    // colRef is a rowId of a column or its negative value (indicating descending order).
    const col = getColumn(Sort.getColRef(colSpec));
    return cssMenuText(
      cssMenuIconWrapper(
        cssMenuIconWrapper.cls('-changed', changedColumns.includes(colSpec)),
        cssMenuIconWrapper.cls(Sort.isAscending(colSpec) ? '-asc' : '-desc'),
        cssIcon('Sort',
          dom.style('transform', Sort.isAscending(colSpec) ? 'scaleY(-1)' : 'none'),
          dom.on('click', () => {
            section.activeSortSpec(Sort.flipSort(sortSpec, colSpec));
          })
        )
      ),
      cssMenuTextLabel(col.colId()),
      cssMenuIconWrapper(
        cssIcon('Remove', testId('btn-remove-sort'), dom.on('click', () => {
          if (Sort.findCol(sortSpec, colSpec)) {
            section.activeSortSpec(Sort.removeCol(sortSpec, colSpec));
          }
        }))
      ),
      testId('sort-col')
    );
  });

  return [
    cssMenuInfoHeader('Sorted by', testId('heading-sorted')),
    sortColumns.length > 0 ? sortColumns : cssGrayedMenuText('(Default)')
  ];
}

// [+] Add Filter.
export function makeAddFilterButton(viewSectionRec: ViewSectionRec, popupControls: WeakMap<ColumnRec, PopupControl>) {
  return dom.domComputed((use) => {
    const filters = use(viewSectionRec.filters);
    return cssMenuText(
      cssMenuIconWrapper(
        cssIcon('Plus'),
        addFilterMenu(filters, viewSectionRec, popupControls, {
          placement: 'bottom-end',
          // Attach content to triggerElem's parent, which is needed to prevent view section menu to
          // close when clicking an item of the add filter menu.
          attach: null
        }),
        testId('plus-button'),
        dom.on('click', (ev) => ev.stopPropagation()),
      ),
      cssMenuTextLabel('Add Filter'),
    );
  });
}

// [v] or [x] Toggle Filter Bar.
export function makeFilterBarToggle(activeFilterBar: CustomComputed<boolean>) {
  return cssMenuText(
    cssMenuIconWrapper(
      testId('btn'),
      cssMenuIconWrapper.cls('-changed', (use) => !use(activeFilterBar.isSaved)),
      dom.domComputed((use) => {
        const filterBar = use(activeFilterBar);
        const isSaved = use(activeFilterBar.isSaved);
        return cssIcon(filterBar ? "Tick" : (isSaved ? "Plus" : "CrossSmall"),
                       cssIcon.cls('-green', Boolean(filterBar)),
                       testId('icon'));
      }),
    ),
    dom.on('click', () => activeFilterBar(!activeFilterBar.peek())),
    cssMenuTextLabel("Toggle Filter Bar"),
  );
}

// Filtered by - section in the menu (contains all filtered columns or (Not filtered) label).
function makeFilterPanel(section: ViewSectionRec, activeFilters: FilterInfo[],
                         popupControls: WeakMap<ColumnRec, PopupControl>,
                         onCloseContent: () => void) {
  const filters = activeFilters.map(filterInfo => {
    const filterChanged = Computed.create(null, fromKo(filterInfo.filter.isSaved), (_use, isSaved) => !isSaved);
    return cssMenuText(
      cssMenuIconWrapper(
        cssMenuIconWrapper.cls('-changed', filterChanged),
        cssIcon('FilterSimple'),
        attachColumnFilterMenu(section, filterInfo, {
          placement: 'bottom-end',
          trigger: [
            'click',
            (_el, popupControl) => popupControls.set(filterInfo.fieldOrColumn.origCol(), popupControl)
          ],
          onCloseContent,
        }),
        testId('filter-icon'),
      ),
      cssMenuTextLabel(filterInfo.fieldOrColumn.label()),
      cssMenuIconWrapper(cssIcon('Remove',
        dom.on('click', () => section.setFilter(filterInfo.fieldOrColumn.origCol().origColRef(), ''))),
        testId('btn-remove-filter')
      ),
      testId('filter-col')
    );
  });

  return [
    cssMenuInfoHeader('Filtered by', {style: 'margin-top: 4px'}, testId('heading-filtered')),
    activeFilters.length > 0 ? filters : cssGrayedMenuText('(Not filtered)')
  ];
}


// Custom Options
// (empty)|(customized)|(modified) [Remove Icon]
function makeCustomOptions(section: ViewSectionRec) {
  const color = Computed.create(null, use => use(section.activeCustomOptions.isSaved) ? "-gray" : "-green");
  const text = Computed.create(null, use => {
    if (use(section.activeCustomOptions)) {
      return use(section.activeCustomOptions.isSaved) ? "(customized)" : "(modified)";
    } else {
      return "(empty)";
    }
  });
  return [
    cssMenuInfoHeader('Custom options', testId('heading-widget-options')),
    cssMenuText(
      dom.autoDispose(text),
      dom.autoDispose(color),
      dom.text(text),
      cssMenuText.cls(color),
      cssSpacer(),
      dom.maybe(use => use(section.activeCustomOptions), () =>
        cssMenuIconWrapper(
          cssIcon('Remove', testId('btn-remove-options'), dom.on('click', () =>
            section.activeCustomOptions(null)
          ))
        ),
      ),
      testId("custom-options")
    )
  ];
}

const clsOldUI = styled('div', ``);

const cssFixHeight = styled('div', `
  margin-top: -3px; /* Section header is 24px, so need to move this up a little bit */
`);

const cssMenu = styled('div', `

  display: inline-flex;
  cursor: pointer;

  border-radius: 3px;
  border: 1px solid transparent;
  &.${clsOldUI.className} {
    margin-top: 0px;
    border-radius: 0px;
  }

  &:hover, &.weasel-popup-open {
    background-color: ${theme.hover};
  }
`);

const cssIconWrapper = styled('div', `
  padding: 3px;
  border-radius: 3px;
  cursor: pointer;
  user-select: none;
`);

const cssMenuIconWrapper = styled(cssIconWrapper, `
  display: flex;
  margin: -3px 0;
  width: 22px;
  height: 22px;

  &:hover, &.weasel-popup-open {
    background-color: ${theme.hover};
  }
  &-changed {
    background-color: ${theme.accentIcon};
  }
  &-changed:hover, &-changed:hover.weasel-popup-open {
    background-color: ${theme.controlHoverFg};
  }
`);

const cssFilterMenuWrapper = styled('div', `
  display: inline-flex;
  margin-right: 10px;
  border-radius: 3px;
  align-items: center;
  &-unsaved {
    border: 1px solid ${theme.accentBorder};
  }
  & .${cssMenu.className} {
    border: none;
  }

`);

const cssIcon = styled(icon, `
  flex: none;
  cursor: pointer;
  background-color: ${theme.lightText};

  .${cssMenuIconWrapper.className}-changed & {
    background-color: ${theme.controlPrimaryFg};
  }

  .${clsOldUI.className} & {
    background-color: ${theme.controlPrimaryFg};
  }

  &-green {
    background-color: ${theme.accentIcon};
  }
`);

const cssDotsIconWrapper = styled(cssIconWrapper, `
  border-radius: 0px 2px 2px 0px;

  .${clsOldUI.className} & {
    border-radius: 0px;
  }
`);

const cssFilterIconWrapper = styled(cssIconWrapper, `
  border-radius: 2px 0px 0px 2px;
  .${cssFilterMenuWrapper.className}-unsaved & {
    background-color: ${theme.accentIcon};
  }
`);

const cssFilterIcon = styled(cssIcon, `
  .${cssFilterIconWrapper.className}-any & {
    background-color: ${theme.accentIcon};
  }
  .${cssFilterMenuWrapper.className}-unsaved & {
    background-color: ${theme.controlPrimaryFg};
  }
`);

const cssMenuInfoHeader = styled('div', `
  color: ${theme.menuSubheaderFg};
  font-weight: ${vars.bigControlTextWeight};
  padding: 8px 24px 8px 24px;
  cursor: default;
`);

const cssMenuText = styled('div', `
  display: flex;
  align-items: center;
  padding: 0px 24px 8px 24px;
  cursor: default;
  white-space: nowrap;
  &-green {
    color: ${theme.accentText};
  }
  &-gray {
    color: ${theme.lightText};
  }
`);

const cssGrayedMenuText = styled(cssMenuText, `
  color: ${theme.lightText};
`);

const cssMenuTextLabel = styled('span', `
  color: ${theme.menuItemFg};
  flex-grow: 1;
  padding: 0 4px;
  overflow: hidden;
  text-overflow: ellipsis;
`);

const cssSaveButton = styled(primaryButton, `
  margin-right: 8px;
`);

const cssSmallIconWrapper = styled('div', `
  width: 16px;
  height: 16px;
  border-radius: 8px;
  margin: 0 5px 0 5px;

  &-green {
    background-color: ${theme.accentIcon};
  }
  &-gray {
    background-color: ${theme.lightText};
  }
  & > .${cssIcon.className} {
    background-color: ${theme.controlPrimaryFg};
  }
`);

const cssSaveIconsWrapper = styled('div', `
  padding: 0 1px 0 1px;
  display: flex;
  justify-content: space-between;
`);

const cssSpacer = styled('div', `
  margin: 0 auto;
`);
