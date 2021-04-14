import {flipColDirection, parseSortColRefs} from 'app/client/lib/sortUtil';
import {ColumnRec, DocModel, ViewFieldRec, ViewRec, ViewSectionRec} from 'app/client/models/DocModel';
import {CustomComputed} from 'app/client/models/modelUtil';
import {attachColumnFilterMenu} from 'app/client/ui/ColumnFilterMenu';
import {makeViewLayoutMenu} from 'app/client/ui/ViewLayoutMenu';
import {basicButton, primaryButton} from 'app/client/ui2018/buttons';
import {colors, vars} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {menu, menuDivider} from 'app/client/ui2018/menus';
import {Computed, dom, fromKo, makeTestId, Observable, styled} from 'grainjs';
import difference = require('lodash/difference');

const testId = makeTestId('test-section-menu-');

type IconSuffix = '' | '-saved' | '-unsaved';

export function viewSectionMenu(docModel: DocModel, viewSection: ViewSectionRec, viewModel: ViewRec,
                                isReadonly: Observable<boolean>, newUI = true) {
  const emptySortFilterObs: Computed<boolean> = Computed.create(null, use => {
    return use(viewSection.activeSortSpec).length === 0 && use(viewSection.filteredFields).length === 0;
  });

  // Using a static subscription to emptySortFilterObs ensures that it's calculated first even if
  // it started in the "unsaved" state (in which a dynamic use()-based subscription to
  // emptySortFilterObs wouldn't be active, which could result in a wrong order of evaluation).
  const iconSuffixObs: Computed<IconSuffix> = Computed.create(null, emptySortFilterObs, (use, empty) => {
    if (use(viewSection.filterSpecChanged) || !use(viewSection.activeSortJson.isSaved)
        || !use(viewSection.activeFilterBar.isSaved)) {
      return '-unsaved';
    } else if (!empty) {
      return '-saved';
    } else {
      return '';
    }
  });

  return cssMenu(
    testId('wrapper'),
    dom.autoDispose(emptySortFilterObs),
    dom.autoDispose(iconSuffixObs),
    dom.cls(clsOldUI.className, !newUI),
    dom.maybe(iconSuffixObs, () => cssFilterIconWrapper(testId('filter-icon'), cssFilterIcon('Filter'))),
    cssMenu.cls(iconSuffixObs),
    cssDotsIconWrapper(cssDotsIcon('Dots')),
    menu(_ctl => {
      return [
        dom.domComputed(use => {
          use(viewSection.activeSortJson.isSaved); // Rebuild sort panel if sort gets saved. A little hacky.
          return makeSortPanel(viewSection, use(viewSection.activeSortSpec),
                               (row: number) => docModel.columns.getRowModel(row));
        }),
        dom.domComputed(viewSection.filteredFields, fields =>
          makeFilterPanel(viewSection, fields)),
        makeFilterBarToggle(viewSection.activeFilterBar),
        dom.domComputed(iconSuffixObs, iconSuffix => {
          const displaySave = iconSuffix === '-unsaved';
          return [
            displaySave ? cssMenuInfoHeader(
              cssSaveButton('Save', testId('btn-save'),
                dom.on('click', async () => {
                  await docModel.docData.bundleActions("Update Sort&Filter settings", () => Promise.all([
                    viewSection.activeSortJson.save(),  // Save sort
                    viewSection.saveFilters(),          // Save filter
                    viewSection.activeFilterBar.save(), // Save bar
                  ]));
                }),
                dom.boolAttr('disabled', isReadonly),
              ),
              basicButton('Revert', testId('btn-revert'),
                dom.on('click', () => {
                  viewSection.activeSortJson.revert();  // Revert sort
                  viewSection.revertFilters();          // Revert filter
                  viewSection.activeFilterBar.revert(); // Revert bar
                })
              )
            ) : null,
            menuDivider()
          ];
        }),
        ...makeViewLayoutMenu(viewModel, viewSection, isReadonly.get())
      ];
    })
  );
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
    dom.on('click', () => activeFilterBar(!activeFilterBar())),
    cssMenuTextLabel("Toggle Filter Bar"),
  );
}


function makeFilterPanel(section: ViewSectionRec, filteredFields: ViewFieldRec[]) {
  const fields = filteredFields.map(field => {
    const fieldChanged = Computed.create(null, fromKo(field.activeFilter.isSaved), (_use, isSaved) => !isSaved);
    return cssMenuText(
      dom.autoDispose(fieldChanged),
      cssMenuIconWrapper(
        cssMenuIconWrapper.cls('-changed', fieldChanged),
        cssIcon('FilterSimple'),
        attachColumnFilterMenu(section, field, {placement: 'bottom-end'}),
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

const cssMenu = styled('div', `
  margin-top: -3px; /* Section header is 24px, so need to move this up a little bit */

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

  &-unsaved, &-unsaved.weasel-popup-open {
    border: 1px solid ${colors.lightGreen};
    background-color: ${colors.lightGreen};
  }
  &-unsaved:hover {
    border: 1px solid ${colors.darkGreen};
    background-color: ${colors.darkGreen};
  }
  &-unsaved.${clsOldUI.className} {
    border: 1px solid transparent;
    background-color: ${colors.lightGreen};
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

  .${cssMenu.className}-unsaved & {
    background-color: white;
  }
`);

const cssDotsIcon = styled(cssIcon, `
  .${clsOldUI.className}.${cssMenu.className}-unsaved & {
    background-color: ${colors.slate};
  }
`);

const cssFilterIconWrapper = styled(cssIconWrapper, `
  border-radius: 2px 0px 0px 2px;
`);

const cssFilterIcon = styled(cssIcon, `
  .${cssMenu.className}-unsaved & {
    background-color: ${colors.light};
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
