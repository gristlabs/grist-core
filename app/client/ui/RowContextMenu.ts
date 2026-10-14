import { allCommands } from "app/client/components/commands";
import { makeT } from "app/client/lib/localization";
import { menuDivider, menuIcon, menuItemCmd, menuItemCmdLabel } from "app/client/ui2018/menus";

import { dom } from "grainjs";

const t = makeT("RowContextMenu");

export interface IRowContextMenu {
  disableInsert: boolean;
  disableDelete: boolean;
  disableMakeHeadersFromRow: boolean;
  disableShowRecordCard: boolean;
  isViewSorted: boolean;
  numRows: number;
  disableAnchorLink?: boolean;
}

export function RowContextMenu({
  disableInsert,
  disableDelete,
  disableMakeHeadersFromRow,
  disableShowRecordCard,
  disableAnchorLink,
  isViewSorted,
  numRows,
}: IRowContextMenu) {
  const result: Element[] = [];
  if (numRows === 1) {
    result.push(
      menuItemCmd(
        allCommands.viewAsCard,
        () => menuItemCmdLabel(menuIcon("TypeCard"), t("View as card")),
        dom.attr("aria-disabled", disableShowRecordCard ? "true" : "false"),
      ),
      menuDivider(),
    );
  }
  if (isViewSorted) {
    // When the view is sorted, any newly added records get shifts instantly at the top or
    // bottom. It could be very confusing for users who might expect the record to stay above or
    // below the active row. Thus in this case we show a single `insert row` command.
    result.push(
      menuItemCmd(allCommands.insertRecordAfter, t("Insert row"),
        dom.attr("aria-disabled", disableInsert ? "true" : "false")),
    );
  } else {
    result.push(
      menuItemCmd(allCommands.insertRecordBefore, t("Insert row above"),
        dom.attr("aria-disabled", disableInsert ? "true" : "false")),
      menuItemCmd(allCommands.insertRecordAfter, t("Insert row below"),
        dom.attr("aria-disabled", disableInsert ? "true" : "false")),
    );
  }
  result.push(
    menuItemCmd(allCommands.duplicateRows, t("Duplicate rows", { count: numRows }),
      dom.attr("aria-disabled", disableInsert || numRows === 0 ? "true" : "false")),
  );
  result.push(
    menuDivider(),
    menuItemCmd(allCommands.makeHeadersFromRow, t("Use as table headers"),
      dom.attr("aria-disabled", disableMakeHeadersFromRow ? "true" : "false")),
  );
  result.push(
    menuDivider(),
    // TODO: should show `Delete ${num} rows` when multiple are selected
    menuItemCmd(allCommands.deleteRecords, t("Delete"),
      dom.attr("aria-disabled", disableDelete ? "true" : "false")),
  );
  result.push(
    menuDivider(),
    menuItemCmd(allCommands.copyLink, t("Copy anchor link"),
      dom.attr("aria-disabled", (disableAnchorLink ?? false) ? "true" : "false")),
  );
  return result;
}
