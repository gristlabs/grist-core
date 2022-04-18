import { allCommands } from 'app/client/components/commands';
import { menuDivider, menuItemCmd } from 'app/client/ui2018/menus';
import { dom } from 'grainjs';
import { IMultiColumnContextMenu } from 'app/client/ui/GridViewMenus';

interface IRowContextMenu {
  disableInsert: boolean;
  disableDelete: boolean;
  isViewSorted: boolean;
  numRows: number;
}

export function CellContextMenu(rowOptions: IRowContextMenu, colOptions: IMultiColumnContextMenu) {

  const { disableInsert, disableDelete, isViewSorted } = rowOptions;
  const { disableModify, isReadonly } = colOptions;

  const disableForReadonlyColumn = dom.cls('disabled', Boolean(disableModify) || isReadonly);
  const disableForReadonlyView = dom.cls('disabled', isReadonly);

  const numCols: number = colOptions.numColumns;
  const nameClearColumns = colOptions.isFiltered ?
    (numCols > 1 ? `Clear ${numCols} entire columns` : 'Clear entire column') :
    (numCols > 1 ? `Clear ${numCols} columns` : 'Clear column');
  const nameDeleteColumns = numCols > 1 ? `Delete ${numCols} columns` : 'Delete column';

  const numRows: number = rowOptions.numRows;
  const nameDeleteRows = numRows > 1 ? `Delete ${numRows} rows` : 'Delete row';

  const nameClearCells = (numRows > 1 || numCols > 1) ? 'Clear values' : 'Clear cell';

  const result: Array<Element|null> = [];

  result.push(

    // TODO: implement copy/paste actions

    colOptions.isFormula ?
      null :
      menuItemCmd(allCommands.clearValues, nameClearCells, disableForReadonlyColumn),
    menuItemCmd(allCommands.clearColumns, nameClearColumns, disableForReadonlyColumn),

    ...(
      (numCols > 1 || numRows > 1) ? [] : [
        menuDivider(),
        menuItemCmd(allCommands.copyLink, 'Copy anchor link'),
        menuDivider(),
        menuItemCmd(allCommands.filterByThisCellValue, `Filter by this value`),
      ]
    ),

    menuDivider(),

    // inserts
    ...(
      isViewSorted ?
        // When the view is sorted, any newly added records get shifts instantly at the top or
        // bottom. It could be very confusing for users who might expect the record to stay above or
        // below the active row. Thus in this case we show a single `insert row` command.
        [menuItemCmd(allCommands.insertRecordAfter, 'Insert row',
                    dom.cls('disabled', disableInsert))] :

        [menuItemCmd(allCommands.insertRecordBefore, 'Insert row above',
                     dom.cls('disabled', disableInsert)),
         menuItemCmd(allCommands.insertRecordAfter, 'Insert row below',
                     dom.cls('disabled', disableInsert))]
    ),

    menuItemCmd(allCommands.insertFieldBefore, 'Insert column to the left',
                disableForReadonlyView),
    menuItemCmd(allCommands.insertFieldAfter, 'Insert column to the right',
                disableForReadonlyView),


    menuDivider(),

    // deletes
    menuItemCmd(allCommands.deleteRecords, nameDeleteRows,
                dom.cls('disabled', disableDelete)),

    menuItemCmd(allCommands.deleteFields, nameDeleteColumns, disableForReadonlyColumn),

    // todo: add "hide N columns"
  );

  return result;
}
