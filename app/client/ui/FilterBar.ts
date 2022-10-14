import {t} from 'app/client/lib/localization';
import { allInclusive } from "app/client/models/ColumnFilter";
import { ColumnRec, ViewFieldRec, ViewSectionRec } from "app/client/models/DocModel";
import { FilterInfo } from "app/client/models/entities/ViewSectionRec";
import { attachColumnFilterMenu } from "app/client/ui/ColumnFilterMenu";
import { cssButton, cssButtonGroup } from "app/client/ui2018/buttons";
import { testId, theme } from "app/client/ui2018/cssVars";
import { icon } from "app/client/ui2018/icons";
import { menu, menuItemAsync } from "app/client/ui2018/menus";
import { dom, IDisposableOwner, IDomArgs, styled } from "grainjs";
import { IMenuOptions, PopupControl } from "popweasel";

export function filterBar(_owner: IDisposableOwner, viewSection: ViewSectionRec) {
  const popupControls = new WeakMap<ColumnRec, PopupControl>();
  return cssFilterBar(
    testId('filter-bar'),
    dom.forEach(viewSection.activeFilters, (filterInfo) => makeFilterField(viewSection, filterInfo, popupControls)),
    makePlusButton(viewSection, popupControls),
  );
}

function makeFilterField(viewSection: ViewSectionRec, filterInfo: FilterInfo,
                         popupControls: WeakMap<ColumnRec, PopupControl>) {
  return cssFilterBarItem(
    testId('filter-field'),
    primaryButton(
      testId('btn'),
      cssIcon('FilterSimple'),
      cssMenuTextLabel(dom.text(filterInfo.fieldOrColumn.origCol().label)),
      cssBtn.cls('-grayed', filterInfo.filter.isSaved),
      attachColumnFilterMenu(viewSection, filterInfo, {
        placement: 'bottom-start', attach: 'body',
        trigger: ['click', (_el, popupControl) => popupControls.set(filterInfo.fieldOrColumn.origCol(), popupControl)]
      }),
    ),
    deleteButton(
      testId('delete'),
      cssIcon('CrossSmall'),
      cssBtn.cls('-grayed', filterInfo.filter.isSaved),
      dom.on('click', () => viewSection.setFilter(filterInfo.fieldOrColumn.origCol().origColRef(), '')),
    )
  );
}

export function addFilterMenu(filters: FilterInfo[], viewSection: ViewSectionRec,
                              popupControls: WeakMap<ColumnRec, PopupControl>, options?: IMenuOptions) {
  return (
    menu((ctl) => [
      ...filters.map((filterInfo) => (
        menuItemAsync(
          () => turnOnAndOpenFilter(filterInfo.fieldOrColumn, viewSection, popupControls),
          filterInfo.fieldOrColumn.origCol().label.peek(),
          dom.cls('disabled', filterInfo.isFiltered),
          testId('add-filter-item'),
        )
      )),
      // We need to stop click event to propagate otherwise it would cause view section menu to
      // close.
      dom.on('click', (ev) => {
        ctl.close();
        ev.stopPropagation();
      }),
    ], options)
  );
}

function turnOnAndOpenFilter(fieldOrColumn: ViewFieldRec|ColumnRec, viewSection: ViewSectionRec,
                             popupControls: WeakMap<ColumnRec, PopupControl>) {
  viewSection.setFilter(fieldOrColumn.origCol().origColRef(), allInclusive);
  popupControls.get(fieldOrColumn.origCol())?.open();
}

function makePlusButton(viewSectionRec: ViewSectionRec, popupControls: WeakMap<ColumnRec, PopupControl>) {
  return dom.domComputed((use) => {
    const filters = use(viewSectionRec.filters);
    const anyFilter = use(viewSectionRec.activeFilters).length > 0;
    return cssPlusButton(
      cssBtn.cls('-grayed'),
      cssIcon('Plus'),
      addFilterMenu(filters, viewSectionRec, popupControls),
      anyFilter ? null : cssPlusLabel(t('FilterBar.AddFilter')),
      testId('add-filter-btn')
    );
  });
}

const cssFilterBar = styled('div.filter_bar', `
  display: flex;
  flex-direction: row;
  margin-bottom: 8px;
  margin-left: -4px;
  overflow-x: scroll;
  scrollbar-width: none;
  &::-webkit-scrollbar {
    display: none;
  }
`);
const cssFilterBarItem = styled(cssButtonGroup, `
  flex-shrink: 0;
  margin: 0 4px;
  & > .${cssButton.className}:first-child {
    border-right: 0.5px solid white;
  }
`);
const cssMenuTextLabel = styled('span', `
  flex-grow: 1;
  padding: 0 4px;
  overflow: hidden;
  text-overflow: ellipsis;
`);
const cssIcon = styled(icon, `
  margin-top: -3px;
`);
const cssBtn = styled('div', `
  height: 24px;
  padding: 3px 8px;
  .${cssFilterBar.className} > & {
    margin: 0 4px;
  }
  &-grayed {
    color:        ${theme.filterBarButtonSavedFg};
    --icon-color: ${theme.filterBarButtonSavedFg};
    background-color: ${theme.filterBarButtonSavedBg};
    border-color: ${theme.filterBarButtonSavedBg};
  }
  &-grayed:hover {
    background-color: ${theme.filterBarButtonSavedHoverBg};
    border-color: ${theme.filterBarButtonSavedHoverBg};
  }
`);
const primaryButton = (...args: IDomArgs<HTMLDivElement>) => (
  dom('div', cssButton.cls(''), cssButton.cls('-primary'),
      cssBtn.cls(''), ...args)
);
const deleteButton = styled(primaryButton, `
  padding: 3px 4px;
`);
const cssPlusButton = styled(primaryButton, `
  padding: 3px 3px
`);
const cssPlusLabel = styled('span', `
  margin: 0 12px 0 4px;
`);
