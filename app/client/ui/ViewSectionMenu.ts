import {flipColDirection, parseSortColRefs} from 'app/client/lib/sortUtil';
import {reportError} from 'app/client/models/AppModel';
import {ColumnRec, DocModel, ViewFieldRec, ViewRec, ViewSectionRec} from 'app/client/models/DocModel';
import {CustomComputed} from 'app/client/models/modelUtil';
import {attachColumnFilterMenu} from 'app/client/ui/ColumnFilterMenu';
import {addFilterMenu} from 'app/client/ui/FilterBar';
import {hoverTooltip} from 'app/client/ui/tooltips';
import {makeViewLayoutMenu} from 'app/client/ui/ViewLayoutMenu';
import {basicButton, primaryButton} from 'app/client/ui2018/buttons';
import {colors, vars} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {menu} from 'app/client/ui2018/menus';
import {Computed, dom, fromKo, IDisposableOwner, makeTestId, Observable, styled} from 'grainjs';
import difference = require('lodash/difference');
import {PopupControl} from 'popweasel';

const testId = makeTestId('test-section-menu-');

const TOOLTIP_DELAY_OPEN = 750;

async function doSave(docModel: DocModel, viewSection: ViewSectionRec): Promise<void> {
  await docModel.docData.bundleActions("Update Sort&Filter settings", () => Promise.all([
    viewSection.activeSortJson.save(),  // Save sort
    viewSection.saveFilters(),          // Save filter
    viewSection.activeFilterBar.save(), // Save bar
  ]));
}

function doRevert(viewSection: ViewSectionRec) {
  viewSection.activeSortJson.revert();  // Revert sort
  viewSection.revertFilters();          // Revert filter
  viewSection.activeFilterBar.revert(); // Revert bar
}

export function viewSectionMenu(owner: IDisposableOwner, docModel: DocModel, viewSection: ViewSectionRec,
                                viewModel: ViewRec, isReadonly: Observable<boolean>) {

  const popupControls = new WeakMap<ViewFieldRec, PopupControl>();
  const anyFilter = Computed.create(owner, (use) => Boolean(use(viewSection.filteredFields).length));

  const displaySaveObs: Computed<boolean> = Computed.create(owner, (use) => (
    use(viewSection.filterSpecChanged)
      || !use(viewSection.activeSortJson.isSaved)
      || !use(viewSection.activeFilterBar.isSaved)
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
        cssFilterIconWrapper(
          testId('filter-icon'),
          cssFilterIconWrapper.cls('-any', anyFilter),
          cssFilterIcon('Filter')
        ),
        menu(ctl => [
          dom.domComputed(use => {
            use(viewSection.activeSortJson.isSaved); // Rebuild sort panel if sort gets saved. A little hacky.
            return makeSortPanel(viewSection, use(viewSection.activeSortSpec),
                                 (row: number) => docModel.columns.getRowModel(row));
          }),
          dom.domComputed(viewSection.filteredFields, fields =>
                          makeFilterPanel(viewSection, fields, popupControls, () => ctl.close())),
          makeAddFilterButton(viewSection, popupControls),
          makeFilterBarToggle(viewSection.activeFilterBar),
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
      dom.maybe(displaySaveObs, () => cssSaveIconsWrapper(
        cssSmallIconWrapper(
          cssIcon('Tick'), cssSmallIconWrapper.cls('-green'),
          dom.on('click', save),
          hoverTooltip(() => 'Save', {key: 'sortFilterButton', openDelay: TOOLTIP_DELAY_OPEN}),
          testId('small-btn-save'),
          dom.hide(isReadonly),
        ),
        cssSmallIconWrapper(
          cssIcon('CrossSmall'), cssSmallIconWrapper.cls('-gray'),
          dom.on('click', revert),
          hoverTooltip(() => 'Revert', {key: 'sortFilterButton', openDelay: TOOLTIP_DELAY_OPEN}),
          testId('small-btn-revert'),
        ),
      )),
    ),
    cssMenu(
      testId('viewLayout'),
      cssFixHeight.cls(''),
      cssDotsIconWrapper(cssIcon('Dots')),
      menu(_ctl => makeViewLayoutMenu(viewModel, viewSection, isReadonly.get()))
    )
  ];
}

function makeSortPanel(section: ViewSectionRec, sortSpec: number[], getColumn: (row: number) => ColumnRec) {
  const changedColumns = difference(sortSpec, parseSortColRefs(section.sortColRefs.peek()));
  const sortColumns = sortSpec.map(colRef => {
    // colRef is a rowId of a column or its negative value (indicating descending order).
    const col = getColumn(Math.abs(colRef));
    return cssMenuText(
      cssMenuIconWrapper(
        cssMenuIconWrapper.cls('-changed', changedColumns.includes(colRef)),
        cssMenuIconWrapper.cls(colRef < 0 ? '-desc' : '-asc'),
        cssIcon('Sort',
          dom.style('transform', colRef < 0 ? 'none' : 'scaleY(-1)'),
          dom.on('click', () => {
            section.activeSortSpec(flipColDirection(sortSpec, colRef));
          })
        )
      ),
      cssMenuTextLabel(col.colId()),
      cssMenuIconWrapper(
        cssIcon('Remove', testId('btn-remove-sort'), dom.on('click', () => {
          const idx = sortSpec.findIndex(c => c === colRef);
          if (idx !== -1) {
            sortSpec.splice(idx, 1);
            section.activeSortSpec(sortSpec);
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

export function makeAddFilterButton(viewSectionRec: ViewSectionRec,
                                    popupControls: WeakMap<ViewFieldRec, PopupControl>) {
  return dom.domComputed((use) => {
    const fields = use(use(viewSectionRec.viewFields).getObservable());
    return cssMenuText(
      cssMenuIconWrapper(
        cssIcon('Plus'),
        addFilterMenu(fields, popupControls, {
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


function makeFilterPanel(section: ViewSectionRec, filteredFields: ViewFieldRec[],
                         popupControls: WeakMap<ViewFieldRec, PopupControl>,
                         onCloseContent: () => void) {
  const fields = filteredFields.map(field => {
    const fieldChanged = Computed.create(null, fromKo(field.activeFilter.isSaved), (_use, isSaved) => !isSaved);
    return cssMenuText(
      dom.autoDispose(fieldChanged),
      cssMenuIconWrapper(
        cssMenuIconWrapper.cls('-changed', fieldChanged),
        cssIcon('FilterSimple'),
        attachColumnFilterMenu(section, field, {
          placement: 'bottom-end',
          trigger: ['click', (_el, popupControl) => popupControls.set(field, popupControl)],
          onCloseContent,
        }),
        testId('filter-icon'),
      ),
      cssMenuTextLabel(field.label()),
      cssMenuIconWrapper(cssIcon('Remove', testId('btn-remove-filter')), dom.on('click', () => field.activeFilter(''))),
      testId('filter-col')
    );
  });

  return [
    cssMenuInfoHeader('Filtered by', {style: 'margin-top: 4px'}, testId('heading-filtered')),
    filteredFields.length > 0 ? fields : cssGrayedMenuText('(Not filtered)')
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
    background-color: ${colors.mediumGrey};
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
    background-color: ${colors.mediumGrey};
  }
  &-changed {
    background-color: ${colors.lightGreen};
  }
  &-changed:hover, &-changed:hover.weasel-popup-open {
    background-color: ${colors.darkGreen};
  }
`);

const cssFilterMenuWrapper = styled('div', `
  display: inline-flex;
  margin-right: 10px;
  border-radius: 3px;
  align-items: center;
  &-unsaved {
    border: 1px solid ${colors.lightGreen};
  }
  & .${cssMenu.className} {
    border: none;
  }

`);

const cssIcon = styled(icon, `
  flex: none;
  cursor: pointer;
  background-color: ${colors.slate};

  .${cssMenuIconWrapper.className}-changed & {
    background-color: white;
  }

  .${clsOldUI.className} & {
    background-color: white;
  }

  &-green {
    background-color: ${colors.lightGreen};
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
    background-color: ${colors.lightGreen};
  }
`);

const cssFilterIcon = styled(cssIcon, `
  .${cssFilterIconWrapper.className}-any & {
    background-color: ${colors.lightGreen};
  }
  .${cssFilterMenuWrapper.className}-unsaved & {
    background-color: white;
  }
`);

const cssMenuInfoHeader = styled('div', `
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
`);

const cssGrayedMenuText = styled(cssMenuText, `
  color: ${colors.slate};
  padding-left: 24px;
`);

const cssMenuTextLabel = styled('span', `
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
    background-color: ${colors.lightGreen};
  }
  &-gray {
    background-color: ${colors.slate};
  }
  & > .${cssIcon.className} {
    background-color: white;
  }
`);


const cssSaveIconsWrapper = styled('div', `
  padding: 0 1px 0 1px;
  display: flex;
  justify-content: space-between;
`);
