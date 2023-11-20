import {allCommands} from 'app/client/components/commands';
import {makeT} from 'app/client/lib/localization';
import {menuDivider, menuItemCmd} from 'app/client/ui2018/menus';
import {dom} from 'grainjs';

const t = makeT('FieldContextMenu');

export interface IFieldContextMenu {
  disableModify: boolean;
  isReadonly: boolean;
}

export function FieldContextMenu(fieldOptions: IFieldContextMenu) {
  const {disableModify, isReadonly} = fieldOptions;
  const disableForReadonlyColumn = dom.cls('disabled', disableModify || isReadonly);
  return [
    menuItemCmd(allCommands.contextMenuCut, t('Cut'), disableForReadonlyColumn),
    menuItemCmd(allCommands.contextMenuCopy, t('Copy')),
    menuItemCmd(allCommands.contextMenuPaste, t('Paste'), disableForReadonlyColumn),
    menuDivider(),
    menuItemCmd(allCommands.clearCardFields, t('Clear field'), disableForReadonlyColumn),
    menuItemCmd(allCommands.hideCardFields, t('Hide field')),
    menuDivider(),
    menuItemCmd(allCommands.copyLink, t('Copy anchor link')),
  ];
}
