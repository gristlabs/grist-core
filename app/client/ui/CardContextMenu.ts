import { allCommands } from 'app/client/components/commands';
import { makeT } from 'app/client/lib/localization';
import { menuDivider, menuItemCmd } from 'app/client/ui2018/menus';
import { dom } from 'grainjs';

const t = makeT('CardContextMenu');

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
  numRows
}: ICardContextMenu) {
  const result: Element[] = [];
  if (isViewSorted) {
    result.push(
      menuItemCmd(allCommands.insertRecordAfter, t("Insert card"),
        dom.cls('disabled', disableInsert)),
    );
  } else {
    result.push(
      menuItemCmd(allCommands.insertRecordBefore, t("Insert card above"),
        dom.cls('disabled', disableInsert)),
      menuItemCmd(allCommands.insertRecordAfter, t("Insert card below"),
        dom.cls('disabled', disableInsert)),
    );
  }
  result.push(
    menuItemCmd(allCommands.duplicateRows, t("Duplicate card"),
      dom.cls('disabled', disableInsert || numRows === 0)),
  );
  result.push(
    menuDivider(),
    menuItemCmd(allCommands.deleteRecords, t("Delete card"),
      dom.cls('disabled', disableDelete)),
  );
  result.push(
    menuDivider(),
    menuItemCmd(allCommands.copyLink, t("Copy anchor link"))
  );
  return result;
}
