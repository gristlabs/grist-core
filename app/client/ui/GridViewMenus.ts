import {allCommands} from 'app/client/components/commands';
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

interface IColumnContextMenu {
  disableModify: boolean;
  filterOpenFunc: () => void;
  useNewUI: boolean;
  sortSpec: number[];
  colId: number;
  isReadonly: boolean;
}

export function ColumnContextMenu(options: IColumnContextMenu) {
  const { disableModify, filterOpenFunc, useNewUI, colId, sortSpec, isReadonly } = options;

  if (useNewUI) {

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
      menuItemCmd(allCommands.renameField, 'Rename column',
        dom.cls('disabled', disableModify || isReadonly)),
      menuItemCmd(allCommands.hideField, 'Hide column',
        dom.cls('disabled', isReadonly)),
      menuItemCmd(allCommands.deleteFields, 'Delete column',
        dom.cls('disabled', disableModify || isReadonly)),
      testId('column-menu'),

      // TODO: this piece should be removed after adding the new way to add column
      menuDivider(),
      menuItemCmd(allCommands.insertFieldBefore, 'Insert column to the left',
        dom.cls('disabled', isReadonly)),
      menuItemCmd(allCommands.insertFieldAfter, 'Insert column to the right',
        dom.cls('disabled', isReadonly)),
    ];
  } else {
    return [
      menuItemCmd(allCommands.fieldTabOpen, 'FieldOptions'),
      menuDivider(),
      menuItemCmd(allCommands.insertFieldBefore, 'Insert column to the left'),
      menuItemCmd(allCommands.insertFieldAfter, 'Insert column to the right'),
      menuDivider(),
      menuItemCmd(allCommands.renameField, 'Rename column',
        dom.cls('disabled', disableModify)),
      menuItemCmd(allCommands.hideField, 'Hide column'),
      menuItemCmd(allCommands.deleteFields, 'Delete column',
        dom.cls('disabled', disableModify)),
      menuItem(filterOpenFunc, 'Filter'),
      menuDivider(),
      menuItemCmd(allCommands.sortAsc, 'Sort ascending'),
      menuItemCmd(allCommands.sortDesc, 'Sort descending'),
      menuItemCmd(allCommands.addSortAsc, 'Add to sort as ascending'),
      menuItemCmd(allCommands.addSortDesc, 'Add to sort as descending'),
    ];
  }
}


interface IMultiColumnContextMenu {
  isReadonly: boolean;
}

export function MultiColumnMenu(options: IMultiColumnContextMenu) {
  const {isReadonly} = options;
  return [
    menuItemCmd(allCommands.insertFieldBefore, 'Insert column to the left',
      dom.cls('disabled', isReadonly)),
    menuItemCmd(allCommands.insertFieldAfter, 'Insert column to the right',
      dom.cls('disabled', isReadonly)),
    menuDivider(),
    menuItemCmd(allCommands.deleteFields, 'Delete columns',
      dom.cls('disabled', isReadonly)),
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
