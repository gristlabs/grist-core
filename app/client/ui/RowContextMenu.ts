import { allCommands } from 'app/client/components/commands';
import { makeT } from 'app/client/lib/localization';
import { RECORD_CARDS } from 'app/client/models/features';
import { menuDivider, menuIcon, menuItemCmd, menuItemCmdLabel } from 'app/client/ui2018/menus';
import { dom } from 'grainjs';

const t = makeT('RowContextMenu');

export interface IRowContextMenu {
  disableInsert: boolean;
  disableDelete: boolean;
  disableShowRecordCard: boolean;
  isViewSorted: boolean;
  numRows: number;
}

export function RowContextMenu({
  disableInsert,
  disableDelete,
  disableShowRecordCard,
  isViewSorted,
  numRows
}: IRowContextMenu) {
  const result: Element[] = [];
  if (RECORD_CARDS() && numRows === 1) {
    result.push(
      menuItemCmd(
        allCommands.viewAsCard,
        () => menuItemCmdLabel(menuIcon('TypeCard'), t("View as card")),
        dom.cls('disabled', disableShowRecordCard),
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
        dom.cls('disabled', disableInsert)),
    );
  } else {
    result.push(
      menuItemCmd(allCommands.insertRecordBefore, t("Insert row above"),
        dom.cls('disabled', disableInsert)),
      menuItemCmd(allCommands.insertRecordAfter, t("Insert row below"),
        dom.cls('disabled', disableInsert)),
    );
  }
  result.push(
    menuItemCmd(allCommands.duplicateRows, t('Duplicate rows', { count: numRows }),
      dom.cls('disabled', disableInsert || numRows === 0)),
  );
  result.push(
    menuDivider(),
    // TODO: should show `Delete ${num} rows` when multiple are selected
    menuItemCmd(allCommands.deleteRecords, t("Delete"),
      dom.cls('disabled', disableDelete)),
  );
  result.push(
    menuDivider(),
    menuItemCmd(allCommands.copyLink, t("Copy anchor link")));
  return result;
}
