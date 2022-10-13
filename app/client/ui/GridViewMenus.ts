import {t} from 'app/client/lib/localization';
import { allCommands } from 'app/client/components/commands';
import { ViewFieldRec } from 'app/client/models/entities/ViewFieldRec';
import { testId, theme } from 'app/client/ui2018/cssVars';
import { icon } from 'app/client/ui2018/icons';
import { menuDivider, menuItem, menuItemCmd } from 'app/client/ui2018/menus';
import { Sort } from 'app/common/SortSpec';
import { dom, DomElementArg, styled } from 'grainjs';
import isEqual = require('lodash/isEqual');

const translate = (x: string, args?: any): string => t(`GridViewMenus.${x}`, args);

interface IView {
  addNewColumn: () => void;
  showColumn: (colId: number, atIndex: number) => void;
}

interface IViewSection {
  viewFields: any;
  hiddenColumns: any;
}

/**
 * Creates a menu to add a new column. Should be used only when there are hidden columns to display,
 * otherwise there is no need for this menu.
 */
export function ColumnAddMenu(gridView: IView, viewSection: IViewSection) {
  return [
    menuItem(() => gridView.addNewColumn(), translate('AddColumn'),
    menuDivider(),
    ...viewSection.hiddenColumns().map((col: any) => menuItem(
      () => {
        gridView.showColumn(col.id(), viewSection.viewFields().peekLength);
        // .then(() => gridView.scrollPaneRight());
      }, translate('ShowColumn', {label: col.label()}))))
  ];
}
export interface IMultiColumnContextMenu {
  // For multiple selection, true/false means the value applies to all columns, 'mixed' means it's
  // true for some columns, but not all.
  numColumns: number;
  numFrozen: number;
  disableModify: boolean|'mixed';  // If the columns are read-only. Mixed for multiple columns where some are read-only.
  isReadonly: boolean;
  isRaw: boolean;
  isFiltered: boolean;            // If this view shows a proper subset of all rows in the table.
  isFormula: boolean|'mixed';
  columnIndices: number[];
  totalColumnCount: number;
  disableFrozenMenu: boolean;
}

interface IColumnContextMenu extends IMultiColumnContextMenu {
  filterOpenFunc: () => void;
  sortSpec: Sort.SortSpec;
  colId: number;
}

export function calcFieldsCondition(fields: ViewFieldRec[], condition: (f: ViewFieldRec) => boolean): boolean|"mixed" {
  return fields.every(condition) ? true : (fields.some(condition) ? "mixed" : false);
}

export function ColumnContextMenu(options: IColumnContextMenu) {
  const { disableModify, filterOpenFunc, colId, sortSpec, isReadonly } = options;

  const disableForReadonlyColumn = dom.cls('disabled', Boolean(disableModify) || isReadonly);

  const addToSortLabel = getAddToSortLabel(sortSpec, colId);

  return [
    menuItemCmd(allCommands.fieldTabOpen, translate('ColumnOptions')),
    menuItem(filterOpenFunc, translate('FilterData')),
    menuDivider({style: 'margin-bottom: 0;'}),
    cssRowMenuItem(
      customMenuItem(
        allCommands.sortAsc.run,
        dom('span', translate('Sort'), {style: 'flex: 1  0 auto; margin-right: 8px;'},
            testId('sort-label')),
        icon('Sort', dom.style('transform', 'scaley(-1)')),
        'A-Z',
        dom.style('flex', ''),
        cssCustomMenuItem.cls('-selected', Sort.containsOnly(sortSpec, colId, Sort.ASC)),
        testId('sort-asc'),
      ),
      customMenuItem(
        allCommands.sortDesc.run,
        icon('Sort'),
        'Z-A',
        cssCustomMenuItem.cls('-selected', Sort.containsOnly(sortSpec, colId, Sort.DESC)),
        testId('sort-dsc'),
      ),
      testId('sort'),
    ),
    addToSortLabel ? [
      cssRowMenuItem(
        customMenuItem(
          allCommands.addSortAsc.run,
          cssRowMenuLabel(addToSortLabel, testId('add-to-sort-label')),
          icon('Sort', dom.style('transform', 'scaley(-1)')),
          'A-Z',
          cssCustomMenuItem.cls('-selected', Sort.contains(sortSpec, colId, Sort.ASC)),
          testId('add-to-sort-asc'),
        ),
        customMenuItem(
          allCommands.addSortDesc.run,
          icon('Sort'),
          'Z-A',
          cssCustomMenuItem.cls('-selected', Sort.contains(sortSpec, colId, Sort.DESC)),
          testId('add-to-sort-dsc'),
        ),
        testId('add-to-sort'),
      ),
    ] : null,
    menuDivider({style: 'margin-bottom: 0; margin-top: 0;'}),
    menuItem(allCommands.sortFilterTabOpen.run, translate('MoreSortOptions'), testId('more-sort-options')),
    menuDivider({style: 'margin-top: 0;'}),
    menuItemCmd(allCommands.renameField, translate('RenameColumn'), disableForReadonlyColumn),
    freezeMenuItemCmd(options),
    menuDivider(),
    MultiColumnMenu((options.disableFrozenMenu = true, options)),
    testId('column-menu'),
  ];
}

/**
 * Note about available options. There is a difference between clearing values (writing empty
 * string, which makes cells blank, including Numeric cells) and converting a column to an empty
 * column (i.e. column with empty formula; in this case a Numeric column becomes all 0s today).
 *
 * We offer both options if data columns are selected. If only formulas, only the second option
 * makes sense.
 */
export function MultiColumnMenu(options: IMultiColumnContextMenu) {
  const disableForReadonlyColumn = dom.cls('disabled', Boolean(options.disableModify) || options.isReadonly);
  const disableForReadonlyView = dom.cls('disabled', options.isReadonly);
  const num: number = options.numColumns;
  const nameClearColumns = options.isFiltered ?
    translate('ClearEntireColumns', {count: num}) :
    translate('ClearColumns', {count: num});
  const nameDeleteColumns = translate('DeleteColumns', {count: num});
  const nameHideColumns = translate('HideColumns', {count: num});
  const frozenMenu = options.disableFrozenMenu ? null : freezeMenuItemCmd(options);
  return [
    frozenMenu ? [frozenMenu, menuDivider()]: null,
    // Offered only when selection includes formula columns, and converts only those.
    (options.isFormula ?
      menuItemCmd(allCommands.convertFormulasToData, translate('ConvertFormulaToData'),
        disableForReadonlyColumn) : null),

    // With data columns selected, offer an additional option to clear out selected cells.
    (options.isFormula !== true ?
      menuItemCmd(allCommands.clearValues, translate('ClearValues'), disableForReadonlyColumn) : null),

    (!options.isRaw ? menuItemCmd(allCommands.hideFields, nameHideColumns, disableForReadonlyView) : null),
    menuItemCmd(allCommands.clearColumns, nameClearColumns, disableForReadonlyColumn),
    menuItemCmd(allCommands.deleteFields, nameDeleteColumns, disableForReadonlyColumn),

    menuDivider(),
    menuItemCmd(allCommands.insertFieldBefore, translate('InsertColumn', {to: 'left'}), disableForReadonlyView),
    menuItemCmd(allCommands.insertFieldAfter, translate('InsertColumn', {to: 'right'}), disableForReadonlyView)
  ];
}

export function freezeAction(options: IMultiColumnContextMenu): { text: string; numFrozen: number; } | null {
 /**
   * When user clicks last column - don't offer freezing
   * When user clicks on a normal column - offer him to freeze all the columns to the
   * left (inclusive).
   * When user clicks on a frozen column - offer him to unfreeze all the columns to the
   * right (inclusive)
   * When user clicks on a set of columns then:
   * - If the set of columns contains the last columns that are frozen - offer unfreezing only those columns
   * - If the set of columns is right after the frozen columns or spans across - offer freezing only those columns
   *
   * All of the above are a single command - toggle freeze
   */

  const length = options.numColumns;

  // make some assertions - number of columns selected should always be > 0
  if (length === 0) { return null; }

  const indices = options.columnIndices;
  const firstColumnIndex = indices[0];
  const lastColumnIndex = indices[indices.length - 1];
  const numFrozen = options.numFrozen;

  // if set has last column in it - don't offer freezing
  if (lastColumnIndex == options.totalColumnCount - 1) {
    return null;
  }

  const isNormalColumn = length === 1 && (firstColumnIndex + 1) > numFrozen;
  const isFrozenColumn = length === 1 && (firstColumnIndex+ 1) <= numFrozen;
  const isSet = length > 1;
  const isLastFrozenSet = isSet && lastColumnIndex + 1 === numFrozen;
  const isFirstNormalSet = isSet && firstColumnIndex === numFrozen;
  const isSpanSet = isSet && firstColumnIndex <= numFrozen && lastColumnIndex >= numFrozen;

  let text = '';

  if (!isSet) {
    if (isNormalColumn) {
      // text to show depends on what user selected and how far are we from
      // last frozen column

      // if user clicked the first column or a column just after frozen set
      if (firstColumnIndex === 0 || firstColumnIndex === numFrozen) {
        text = translate('FreezeColumn', {count: 1});
      } else {
        // else user clicked any other column that is farther, offer to freeze
        // proper number of column
        const properNumber = firstColumnIndex - numFrozen + 1;
        text = translate('FreezeColumn', {count: properNumber, context: numFrozen ? 'more' : '' });
      }
      return {
        text,
        numFrozen : firstColumnIndex + 1
      };
    } else if (isFrozenColumn) {
      // when user clicked last column in frozen set - offer to unfreeze this column
      if (firstColumnIndex + 1 === numFrozen) {
        text = translate('UnfreezeColumn', {count: 1});
      } else {
        // else user clicked column that is not the last in a frozen set
        // offer to unfreeze proper number of columns
        const properNumber = numFrozen - firstColumnIndex;
        text = translate('UnfreezeColumn', {count: properNumber, context: properNumber === numFrozen ? 'all' : '' });
      }
      return {
        text,
        numFrozen : indices[0]
      };
    } else {
      return null;
    }
  } else {
    if (isLastFrozenSet) {
      text = translate('UnfreezeColumn', {count: length});
      return {
        text,
        numFrozen : numFrozen - length
      };
    } else if (isFirstNormalSet) {
      text = translate('UnfreezeColumn', {count: length});
      return {
        text,
        numFrozen : numFrozen + length
      };
    } else if (isSpanSet) {
      const toFreeze = lastColumnIndex + 1 - numFrozen;
      text = translate('FreezeColumn', {count: toFreeze, context: 'more'});
      return {
        text,
        numFrozen : numFrozen + toFreeze
      };
    }  else {
      return null;
    }
  }
}

function freezeMenuItemCmd(options: IMultiColumnContextMenu) {
  // calculate action available for this options
  const toggle = freezeAction(options);
  // if we can't offer freezing - don't create a menu at all
  // this shouldn't happen - as current design offers some action on every column
  if (!toggle) { return null; }
  // create menu item if we have something to offer
  return menuItemCmd(allCommands.toggleFreeze, toggle.text);
}

// Returns 'Add to sort' is there are columns in the sort spec but colId is not part of it. Returns
// undefined if colId is the only column in the spec. Otherwise returns `Sorted (#N)` where #N is
// the position (1 based) of colId in the spec.
function getAddToSortLabel(sortSpec: Sort.SortSpec, colId: number): string|undefined {
  const columnsInSpec = sortSpec.map((n) =>Sort.getColRef(n));
  if (sortSpec.length !== 0 && !isEqual(columnsInSpec, [colId])) {
    const index = columnsInSpec.indexOf(colId);
    if (index > -1) {
      return translate('AddToSort', {count: index + 1, context: 'added'});//`Sorted (#${index + 1})`;
    } else {
      return translate('AddToSort');//'Add to sort';
    }
  }
}

const cssRowMenuItem = styled((...args: DomElementArg[]) => dom('li', {tabindex: '-1'}, ...args), `
  display: flex;
  outline: none;
`);

const cssRowMenuLabel = styled('div', `
  margin-right: 8px;
  flex: 1 0 auto;
`);

const cssCustomMenuItem = styled('div', `
  padding: 8px 8px;
  display: flex;
  &:not(:hover) {
    background-color: ${theme.menuBg};
    color: ${theme.menuItemFg};
    --icon-color: ${theme.menuItemFg};
  }
  &:last-of-type {
    padding-right: 24px;
    flex: 0 0 auto;
  }
  &:first-of-type {
    padding-left: 24px;
    flex: 1 0 auto;
  }
  &-selected, &-selected:not(:hover) {
    background-color: ${theme.menuItemSelectedBg};
    color: ${theme.menuItemSelectedFg};
    --icon-color: ${theme.menuItemSelectedFg};
  }
`);

function customMenuItem(action: () => void, ...args: DomElementArg[]) {
  const element: HTMLElement = cssCustomMenuItem(
    ...args,
    dom.on('click', () => action()),
  );
  return element;
}
