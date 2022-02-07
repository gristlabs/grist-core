import { allCommands } from 'app/client/components/commands';
import { menuDivider, menuItemCmd } from 'app/client/ui2018/menus';
import { dom } from 'grainjs';

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
    // TODO: should show `Delete ${num} rows` when multiple are selected
    menuItemCmd(allCommands.deleteRecords, 'Delete',
      dom.cls('disabled', disableDelete)),
  );
  result.push(
    menuDivider(),
    menuItemCmd(allCommands.copyLink, 'Copy anchor link'));
  return result;
}
