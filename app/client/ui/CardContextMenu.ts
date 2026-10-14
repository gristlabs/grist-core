import { allCommands } from "app/client/components/commands";
import { makeT } from "app/client/lib/localization";
import { menuDivider, menuItemCmd } from "app/client/ui2018/menus";

import { dom } from "grainjs";

const t = makeT("CardContextMenu");

export interface ICardContextMenu {
  disableInsert: boolean;
  disableDelete: boolean;
  isViewSorted: boolean;
  numRows: number;
}

export function CardContextMenu({
  disableInsert,
  disableDelete,
  isViewSorted,
  numRows,
}: ICardContextMenu) {
  const result: Element[] = [];
  if (isViewSorted) {
    result.push(
      menuItemCmd(allCommands.insertRecordAfter, t("Insert card"),
        dom.attr("aria-disabled", disableInsert ? "true" : "false")),
    );
  } else {
    result.push(
      menuItemCmd(allCommands.insertRecordBefore, t("Insert card above"),
        dom.attr("aria-disabled", disableInsert ? "true" : "false")),
      menuItemCmd(allCommands.insertRecordAfter, t("Insert card below"),
        dom.attr("aria-disabled", disableInsert ? "true" : "false")),
    );
  }
  result.push(
    menuItemCmd(allCommands.duplicateRows, t("Duplicate card"),
      dom.attr("aria-disabled", disableInsert || numRows === 0 ? "true" : "false")),
  );
  result.push(
    menuDivider(),
    menuItemCmd(allCommands.deleteRecords, t("Delete card"),
      dom.attr("aria-disabled", disableDelete ? "true" : "false")),
  );
  result.push(
    menuDivider(),
    menuItemCmd(allCommands.copyLink, t("Copy anchor link")),
  );
  return result;
}
