import { allCommands } from "app/client/components/commands";
import { ariaDisabled } from "app/client/lib/domUtils";
import { makeT } from "app/client/lib/localization";
import { menuDivider, menuItemCmd } from "app/client/ui2018/menus";

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
        ariaDisabled(disableInsert)),
    );
  } else {
    result.push(
      menuItemCmd(allCommands.insertRecordBefore, t("Insert card above"),
        ariaDisabled(disableInsert)),
      menuItemCmd(allCommands.insertRecordAfter, t("Insert card below"),
        ariaDisabled(disableInsert)),
    );
  }
  result.push(
    menuItemCmd(allCommands.duplicateRows, t("Duplicate card"),
      ariaDisabled(disableInsert || numRows === 0)),
  );
  result.push(
    menuDivider(),
    menuItemCmd(allCommands.deleteRecords, t("Delete card"),
      ariaDisabled(disableDelete)),
  );
  result.push(
    menuDivider(),
    menuItemCmd(allCommands.copyLink, t("Copy anchor link")),
  );
  return result;
}
