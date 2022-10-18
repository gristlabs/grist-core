import {t} from 'app/client/lib/localization';
import { allCommands } from 'app/client/components/commands';
import { menuDivider, menuItemCmd } from 'app/client/ui2018/menus';
import { IMultiColumnContextMenu } from 'app/client/ui/GridViewMenus';
import { IRowContextMenu } from 'app/client/ui/RowContextMenu';
import { COMMENTS } from 'app/client/models/features';
import { dom } from 'grainjs';

const translate = (x: string, args?: any): string => t(`CellContextMenu.${x}`, args);

export function CellContextMenu(rowOptions: IRowContextMenu, colOptions: IMultiColumnContextMenu) {

  const { disableInsert, disableDelete, isViewSorted } = rowOptions;
  const { disableModify, isReadonly } = colOptions;

  // disableModify is true if the column is a summary column or is being transformed.
  // isReadonly is true for readonly mode.
  const disableForReadonlyColumn = dom.cls('disabled', Boolean(disableModify) || isReadonly);
  const disableForReadonlyView = dom.cls('disabled', isReadonly);

  const numCols: number = colOptions.numColumns;
  const nameClearColumns = colOptions.isFiltered ? translate("ClearEntireColumns", {count: numCols}) : translate("ClearColumns", {count: numCols})
  const nameDeleteColumns = translate("DeleteColumns", {count: numCols})

  const numRows: number = rowOptions.numRows;
  const nameDeleteRows = translate("DeleteRows", {count: numRows})

  const nameClearCells = (numRows > 1 || numCols > 1) ? translate('ClearValues') : translate('ClearCell');

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
        menuItemCmd(allCommands.copyLink, translate('CopyAnchorLink')),
        menuDivider(),
        menuItemCmd(allCommands.filterByThisCellValue, translate("FilterByValue")),
        menuItemCmd(allCommands.openDiscussion, 'Comment', dom.cls('disabled', (
         isReadonly || numRows === 0 || numCols === 0
        )), dom.hide(use => !use(COMMENTS()))) //TODO: i18next
      ]
    ),

    menuDivider(),

    // inserts
    ...(
      isViewSorted ?
        // When the view is sorted, any newly added records get shifts instantly at the top or
        // bottom. It could be very confusing for users who might expect the record to stay above or
        // below the active row. Thus in this case we show a single `insert row` command.
        [menuItemCmd(allCommands.insertRecordAfter, translate("InsertRow"),
                    dom.cls('disabled', disableInsert))] :

        [menuItemCmd(allCommands.insertRecordBefore, translate("InsertRowAbove"),
                     dom.cls('disabled', disableInsert)),
         menuItemCmd(allCommands.insertRecordAfter, translate("InsertRowBelow"),
                     dom.cls('disabled', disableInsert))]
    ),
    menuItemCmd(allCommands.duplicateRows, translate("DuplicateRows", {count: numRows}),
        dom.cls('disabled', disableInsert || numRows === 0)),
    menuItemCmd(allCommands.insertFieldBefore, translate("InsertColumnLeft"),
                disableForReadonlyView),
    menuItemCmd(allCommands.insertFieldAfter, translate("InsertColumnRight"),
                disableForReadonlyView),


    menuDivider(),

    // deletes
    menuItemCmd(allCommands.deleteRecords, nameDeleteRows, dom.cls('disabled', disableDelete)),

    menuItemCmd(allCommands.deleteFields, nameDeleteColumns, disableForReadonlyColumn),

    // todo: add "hide N columns"
  );

  return result;
}
