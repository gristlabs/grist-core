import { GristDoc } from "app/client/components/GristDoc";
import { NEW_FILTER_JSON } from "app/client/models/ColumnFilter";
import { ColumnRec, ViewSectionRec } from "app/client/models/DocModel";
import { FilterInfo } from "app/client/models/entities/ViewSectionRec";
import { attachColumnFilterMenu } from "app/client/ui/ColumnFilterMenu";
import { cssButton } from "app/client/ui2018/buttons";
import { testId, theme, vars } from "app/client/ui2018/cssVars";
import { icon } from "app/client/ui2018/icons";
import { dom, IDisposableOwner, IDomArgs, styled } from "grainjs";
import { IPopupOptions, PopupControl } from "popweasel";
import { makeT } from "app/client/lib/localization";
import { dropdownWithSearch } from "app/client/ui/searchDropdown";

const t = makeT('FilterBar');

export function filterBar(
  _owner: IDisposableOwner,
  gristDoc: GristDoc,
  viewSection: ViewSectionRec
) {
  const popupControls = new WeakMap<ColumnRec, PopupControl>();
  return cssFilterBar(
    testId('filter-bar'),
    dom.forEach(viewSection.activeFilters, (filterInfo) => makeFilterField(filterInfo, popupControls)),
    dom.maybe(viewSection.showNestedFilteringPopup, () => {
      return dom('div',
        gristDoc.behavioralPrompts.attachTip('nestedFiltering', {
          onDispose: () => viewSection.showNestedFilteringPopup.set(false),
        }),
      );
    }),
    makePlusButton(viewSection, popupControls),
    cssFilterBar.cls('-hidden', use => use(viewSection.pinnedActiveFilters).length === 0),
  );
}

function makeFilterField(filterInfo: FilterInfo, popupControls: WeakMap<ColumnRec, PopupControl>) {
  const {fieldOrColumn, filter, pinned, isPinned} = filterInfo;
  return cssFilterBarItem(
    testId('filter-field'),
    primaryButton(
      testId('btn'),
      cssIcon('FilterSimple'),
      cssMenuTextLabel(dom.text(fieldOrColumn.origCol().label)),
      cssBtn.cls('-grayed', use => use(filter.isSaved) && use(pinned.isSaved)),
      attachColumnFilterMenu(filterInfo, {
        popupOptions: {
          placement: 'bottom-start',
          attach: 'body',
          trigger: [
            'click',
            (_el, popupControl) => popupControls.set(fieldOrColumn.origCol(), popupControl),
          ],
        },
        showAllFiltersButton: true,
      }),
    ),
    cssFilterBarItem.cls('-unpinned', use => !use(isPinned)),
  );
}

export interface AddFilterMenuOptions {
  /**
   * If 'only-unfiltered', only columns without active filters will be selectable in
   * the menu.
   *
   * If 'unpinned-or-unfiltered', columns that have active filters but are not pinned
   * will also be selectable.
   *
   * Defaults to `only-unfiltered'.
   */
  allowedColumns?: 'only-unfiltered' | 'unpinned-or-unfiltered';
  /**
   * Options that are passed to the menu component.
   */
  menuOptions?: IPopupOptions;
}

export function addFilterMenu(
  filters: FilterInfo[],
  popupControls: WeakMap<ColumnRec, PopupControl>,
  options: AddFilterMenuOptions = {}
) {
  const {allowedColumns, menuOptions} = options;
  return (
    dropdownWithSearch<FilterInfo>({
      action: (filterInfo) => openFilter(filterInfo, popupControls),
      options: () => filters.map((filterInfo) => ({
        label: filterInfo.fieldOrColumn.origCol().label.peek(),
        value: filterInfo,
        disabled: allowedColumns === 'unpinned-or-unfiltered'
          ? filterInfo.isPinned.peek() && filterInfo.isFiltered.peek()
          : filterInfo.isFiltered.peek()
      })),
      popupOptions: menuOptions,
      placeholder: t('Search Columns'),
    })
  );
}

function openFilter(
  {fieldOrColumn, isFiltered, viewSection}: FilterInfo,
  popupControls: WeakMap<ColumnRec, PopupControl>,
) {
  viewSection.setFilter(fieldOrColumn.origCol().origColRef(), {
    filter: isFiltered.peek() ? undefined : NEW_FILTER_JSON,
    pinned: true,
  });
  popupControls.get(fieldOrColumn.origCol())?.open();
}

function makePlusButton(viewSectionRec: ViewSectionRec, popupControls: WeakMap<ColumnRec, PopupControl>) {
  return dom.domComputed((use) => {
    const filters = use(viewSectionRec.filters);
    return cssPlusButton(
      cssBtn.cls('-grayed'),
      cssIcon('Plus'),
      addFilterMenu(filters, popupControls, {
        allowedColumns: 'unpinned-or-unfiltered',
      }),
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
  &-hidden {
    display: none;
  }
`);
const cssFilterBarItem = styled('div', `
  border-radius: ${vars.controlBorderRadius};
  flex-shrink: 0;
  margin: 0 4px;
  &-unpinned {
    display: none;
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
const cssPlusButton = styled(primaryButton, `
  padding: 3px 3px
`);
