import {allCommands} from 'app/client/components/commands';
import {makeT} from 'app/client/lib/localization';
import {ViewFieldRec} from 'app/client/models/entities/ViewFieldRec';
import {menuDivider, menuItemCmd} from 'app/client/ui2018/menus';
import {dom} from 'grainjs';

const t = makeT('FieldContextMenu');

export interface IFieldContextMenu {
  disableModify: boolean;
  isReadonly: boolean;
  field: ViewFieldRec;
  isAddRow: boolean;
}

export function FieldContextMenu(fieldOptions: IFieldContextMenu) {
  const {disableModify, isReadonly, field, isAddRow} = fieldOptions;
  const disableForReadonlyColumn = dom.cls('disabled', disableModify || isReadonly);

  const isVirtual = typeof field.colRef.peek() === 'string';
  const disabledForVirtual = dom.cls('disabled', isVirtual);

  return [
    menuItemCmd(allCommands.contextMenuCut, t('Cut'), disableForReadonlyColumn),
    menuItemCmd(allCommands.contextMenuCopy, t('Copy')),
    menuItemCmd(allCommands.contextMenuPaste, t('Paste'), disableForReadonlyColumn),
    menuDivider(),
    menuItemCmd(allCommands.clearValues, t('Clear field'), disableForReadonlyColumn),
    menuItemCmd(allCommands.hideCardFields, t('Hide field'), disableForReadonlyColumn),
    menuDivider(),
    menuItemCmd(allCommands.openDiscussion, t('Comment'), dom.cls('disabled', isReadonly || isVirtual || isAddRow)),
    menuItemCmd(allCommands.copyLink, t('Copy anchor link'), disabledForVirtual),
  ];
}
