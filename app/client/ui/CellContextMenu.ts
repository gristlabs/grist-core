import { allCommands } from "app/client/components/commands";
import { makeT } from "app/client/lib/localization";
import { IMultiColumnContextMenu } from "app/client/ui/GridViewMenus";
import { menuDivider, menuItemCmd } from "app/client/ui2018/menus";

import { dom } from "grainjs";

const t = makeT("CellContextMenu");

export interface ICellContextMenu {
  disableInsert: boolean;
  disableDelete: boolean;
  isViewSorted: boolean;
  numRows: number;
  disableAnchorLink?: boolean;
  onlyAddRowSelected?: boolean;
}

export function CellContextMenu(cellOptions: ICellContextMenu, colOptions: IMultiColumnContextMenu) {
  const { disableInsert, disableDelete, isViewSorted, numRows, onlyAddRowSelected } = cellOptions;
  const { numColumns, disableModify, isReadonly, isFiltered } = colOptions;

  // disableModify is true if the column is a summary column or is being transformed.
  // isReadonly is true for readonly mode.
  const disableForReadonlyColumn = dom.attr("aria-disabled", (Boolean(disableModify) || isReadonly) ? "true" : "false");
  const disableForReadonlyView = dom.attr("aria-disabled", isReadonly ? "true" : "false");

  const nameClearColumns = isFiltered ?
    t("Reset {{count}} entire columns", { count: numColumns }) :
    t("Reset {{count}} columns", { count: numColumns });
  const nameDeleteColumns = t("Delete {{count}} columns", { count: numColumns });

  const nameDeleteRows = t("Delete {{count}} rows", { count: numRows });

  const nameClearCells = (numRows > 1 || numColumns > 1) ? t("Clear values") : t("Clear cell");

  const result: (Element | null)[] = [];

  result.push(
    menuItemCmd(allCommands.contextMenuCut, t("Cut"), disableForReadonlyColumn),
    menuItemCmd(allCommands.contextMenuCopy, t("Copy")),
    menuItemCmd(allCommands.contextMenuCopyWithHeaders, t("Copy with headers")),
    menuItemCmd(allCommands.contextMenuPaste, t("Paste"), disableForReadonlyColumn),
    menuDivider(),
    colOptions.isFormula ?
      null :
      menuItemCmd(allCommands.clearValues, nameClearCells, disableForReadonlyColumn),
    menuItemCmd(allCommands.clearColumns, nameClearColumns, disableForReadonlyColumn),

    ...(
      (numColumns > 1 || numRows > 1) ? [] : [
        menuDivider(),
        menuItemCmd(allCommands.copyLink,
          t("Copy anchor link"),
          dom.attr("aria-disabled", (cellOptions.disableAnchorLink ?? false) ? "true" : "false"),
        ),
        menuDivider(),
        menuItemCmd(allCommands.filterByThisCellValue, t("Filter by this value")),
        menuItemCmd(allCommands.openDiscussion, t("Comment"), dom.attr("aria-disabled", (
          isReadonly || numRows === 0 || numColumns === 0 || onlyAddRowSelected
        ) ? "true" : "false")),
      ]
    ),

    menuDivider(),

    // inserts
    ...(
      isViewSorted ?
        // When the view is sorted, any newly added records get shifts instantly at the top or
        // bottom. It could be very confusing for users who might expect the record to stay above or
        // below the active row. Thus in this case we show a single `insert row` command.
        [menuItemCmd(allCommands.insertRecordAfter, t("Insert row"),
          dom.attr("aria-disabled", disableInsert ? "true" : "false"))] :

        [menuItemCmd(allCommands.insertRecordBefore, t("Insert row above"),
          dom.attr("aria-disabled", disableInsert ? "true" : "false")),
        menuItemCmd(allCommands.insertRecordAfter, t("Insert row below"),
          dom.attr("aria-disabled", disableInsert ? "true" : "false"))]
    ),
    menuItemCmd(allCommands.duplicateRows, t("Duplicate rows", { count: numRows }),
      dom.attr("aria-disabled", (disableInsert || numRows === 0) ? "true" : "false")),
    menuItemCmd(allCommands.insertFieldBefore, t("Insert column to the left"),
      disableForReadonlyView),
    menuItemCmd(allCommands.insertFieldAfter, t("Insert column to the right"),
      disableForReadonlyView),

    menuDivider(),

    // deletes
    menuItemCmd(allCommands.deleteRecords, nameDeleteRows, dom.attr("aria-disabled", disableDelete ? "true" : "false")),

    menuItemCmd(allCommands.deleteFields, nameDeleteColumns, disableForReadonlyColumn),

    // todo: add "hide N columns"
  );

  return result;
}
