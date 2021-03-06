import {allCommands} from 'app/client/components/commands';
import {ViewFieldRec} from 'app/client/models/entities/ViewFieldRec';
import {testId, vars} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {menuDivider, menuItem, menuItemCmd} from 'app/client/ui2018/menus';
import {dom, DomElementArg, styled} from 'grainjs';
import isEqual = require('lodash/isEqual');

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
    menuItem(() => gridView.addNewColumn(), 'Add Column'),
    menuDivider(),
    ...viewSection.hiddenColumns().map((col: any) => menuItem(
      () => {
        gridView.showColumn(col.id(), viewSection.viewFields().peekLength);
        // .then(() => gridView.scrollPaneRight());
      }, `Show column ${col.label()}`))
  ];
}

interface IRowContextMenu {
  disableInsert: boolean;
  disableDelete: boolean;
  isViewSorted: boolean;
}

export function RowContextMenu({ disableInsert, disableDelete, isViewSorted }: IRowContextMenu) {
  const result: Element[] = [];
  if (isViewSorted) {
    // When the view is sorted, any newly added records get shifts instantly at the top or
    // bottom. It could be very confusing for users who might expect the record to stay above or
    // below the active row. Thus in this case we show a single `insert row` command.
    result.push(
      menuItemCmd(allCommands.insertRecordAfter, 'Insert row',
        dom.cls('disabled', disableInsert)),
    );
  } else {
    result.push(
      menuItemCmd(allCommands.insertRecordBefore, 'Insert row above',
        dom.cls('disabled', disableInsert)),
      menuItemCmd(allCommands.insertRecordAfter, 'Insert row below',
        dom.cls('disabled', disableInsert)),
    );
  }
  result.push(
    menuDivider(),
    menuItemCmd(allCommands.deleteRecords, 'Delete',
      dom.cls('disabled', disableDelete)),
  );
  result.push(
    menuDivider(),
    menuItemCmd(allCommands.copyLink, 'Copy anchor link'));
  return result;
}

interface IMultiColumnContextMenu {
  // For multiple selection, true/false means the value applies to all columns, 'mixed' means it's
  // true for some columns, but not all.
  numColumns: number;
  disableModify: boolean|'mixed';  // If the columns are read-only.
  isReadonly: boolean;
  isFiltered: boolean;            // If this view shows a proper subset of all rows in the table.
  isFormula: boolean|'mixed';
}

interface IColumnContextMenu extends IMultiColumnContextMenu {
  filterOpenFunc: () => void;
  sortSpec: number[];
  colId: number;
}

export function calcFieldsCondition(fields: ViewFieldRec[], condition: (f: ViewFieldRec) => boolean): boolean|"mixed" {
  return fields.every(condition) ? true : (fields.some(condition) ? "mixed" : false);
}

export function ColumnContextMenu(options: IColumnContextMenu) {
  const { disableModify, filterOpenFunc, colId, sortSpec, isReadonly } = options;

  const disableForReadonlyColumn = dom.cls('disabled', Boolean(disableModify) || isReadonly);
  const disableForReadonlyView = dom.cls('disabled', isReadonly);

  const addToSortLabel = getAddToSortLabel(sortSpec, colId);
  return [
    menuItemCmd(allCommands.fieldTabOpen, 'Column Options'),
    menuItem(filterOpenFunc, 'Filter Data'),
    menuDivider({style: 'margin-bottom: 0;'}),
    cssRowMenuItem(
      customMenuItem(
        allCommands.sortAsc.run,
        dom('span', 'Sort', {style: 'flex: 1  0 auto; margin-right: 8px;'},
            testId('sort-label')),
        icon('Sort', dom.style('transform', 'scaley(-1)')),
        'A-Z',
        dom.style('flex', ''),
        cssCustomMenuItem.cls('-selected', isEqual(sortSpec, [colId])),
        testId('sort-asc'),
      ),
      customMenuItem(
        allCommands.sortDesc.run,
        icon('Sort'),
        'Z-A',
        cssCustomMenuItem.cls('-selected', isEqual(sortSpec, [-colId])),
        testId('sort-dsc'),
      ),
      testId('sort'),
    ),
    menuDivider({style: 'margin-bottom: 0; margin-top: 0;'}),
    addToSortLabel ? [
      cssRowMenuItem(
        customMenuItem(
          allCommands.addSortAsc.run,
          cssRowMenuLabel(addToSortLabel, testId('add-to-sort-label')),
          icon('Sort', dom.style('transform', 'scaley(-1)')),
          'A-Z',
          cssCustomMenuItem.cls('-selected', sortSpec.includes(colId)),
          testId('add-to-sort-asc'),
        ),
        customMenuItem(
          allCommands.addSortDesc.run,
          icon('Sort'),
          'Z-A',
          cssCustomMenuItem.cls('-selected', sortSpec.includes(-colId)),
          testId('add-to-sort-dsc'),
        ),
        testId('add-to-sort'),
      ),
      menuDivider({style: 'margin-top: 0;'}),
    ] : null,
    menuItemCmd(allCommands.renameField, 'Rename column', disableForReadonlyColumn),
    menuItemCmd(allCommands.hideField, 'Hide column', disableForReadonlyView),

    menuDivider(),
    MultiColumnMenu(options),
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
    (num > 1 ? `Clear ${num} entire columns` : 'Clear entire column') :
    (num > 1 ? `Clear ${num} columns` : 'Clear column');
  const nameDeleteColumns = num > 1 ? `Delete ${num} columns` : 'Delete column';
  return [
    // TODO This should be made to work too for multiple columns.
    // menuItemCmd(allCommands.hideField, 'Hide column', disableForReadonlyView),

    // Offered only when selection includes formula columns, and converts only those.
    (options.isFormula ?
      menuItemCmd(allCommands.convertFormulasToData, 'Convert formula to data',
        disableForReadonlyColumn) : null),

    // With data columns selected, offer an additional option to clear out selected cells.
    (options.isFormula !== true ?
      menuItemCmd(allCommands.clearValues, 'Clear values', disableForReadonlyColumn) : null),

    menuItemCmd(allCommands.clearColumns, nameClearColumns, disableForReadonlyColumn),
    menuItemCmd(allCommands.deleteFields, nameDeleteColumns, disableForReadonlyColumn),

    menuDivider(),
    menuItemCmd(allCommands.insertFieldBefore, 'Insert column to the left', disableForReadonlyView),
    menuItemCmd(allCommands.insertFieldAfter, 'Insert column to the right', disableForReadonlyView),
  ];
}

// Returns 'Add to sort' is there are columns in the sort spec but colId is not part of it. Returns
// undefined if colId is the only column in the spec. Otherwise returns `Sorted (#N)` where #N is
// the position (1 based) of colId in the spec.
function getAddToSortLabel(sortSpec: number[], colId: number): string|undefined {
  const columnsInSpec = sortSpec.map((n) => Math.abs(n));
  if (sortSpec.length !== 0 && !isEqual(columnsInSpec, [colId])) {
    const index = columnsInSpec.indexOf(colId);
    if (index > -1) {
      return `Sorted (#${index + 1})`;
    } else {
      return 'Add to sort';
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
    background-color: white;
    color: black;
    --icon-color: black;
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
    background-color: ${vars.primaryBg};
    color: white;
    --icon-color: white;
  }
`);

function customMenuItem(action: () => void, ...args: DomElementArg[]) {
  const element: HTMLElement = cssCustomMenuItem(
    ...args,
    dom.on('click', () => action()),
  );
  return element;
}
