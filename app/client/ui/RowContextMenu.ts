import { allCommands } from 'app/client/components/commands';
import {t} from 'app/client/lib/localization';
import { menuDivider, menuItemCmd } from 'app/client/ui2018/menus';
import { dom } from 'grainjs';

const translate = (x: string, args?: any): string => t(`RowContextMenu.${x}`, args);

export interface IRowContextMenu {
  disableInsert: boolean;
  disableDelete: boolean;
  isViewSorted: boolean;
  numRows: number;
}

export function RowContextMenu({ disableInsert, disableDelete, isViewSorted, numRows }: IRowContextMenu) {
  const result: Element[] = [];
  if (isViewSorted) {
    // When the view is sorted, any newly added records get shifts instantly at the top or
    // bottom. It could be very confusing for users who might expect the record to stay above or
    // below the active row. Thus in this case we show a single `insert row` command.
    result.push(
      menuItemCmd(allCommands.insertRecordAfter, translate('InsertRow'),
        dom.cls('disabled', disableInsert)),
    );
  } else {
    result.push(
      menuItemCmd(allCommands.insertRecordBefore, translate('InsertRowAbove'),
        dom.cls('disabled', disableInsert)),
      menuItemCmd(allCommands.insertRecordAfter, translate('InsertRowBelow'),
        dom.cls('disabled', disableInsert)),
    );
  }
  result.push(
    menuItemCmd(allCommands.duplicateRows, translate('DuplicateRows', { count: numRows }),
      dom.cls('disabled', disableInsert || numRows === 0)),
  );
  result.push(
    menuDivider(),
    // TODO: should show `Delete ${num} rows` when multiple are selected
    menuItemCmd(allCommands.deleteRecords, translate('Delete'),
      dom.cls('disabled', disableDelete)),
  );
  result.push(
    menuDivider(),
    menuItemCmd(allCommands.copyLink, translate('CopyAnchorLink')));
  return result;
}
