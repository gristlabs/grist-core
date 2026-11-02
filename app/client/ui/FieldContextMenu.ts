import { allCommands } from "app/client/components/commands";
import { ariaDisabled } from "app/client/lib/domUtils";
import { makeT } from "app/client/lib/localization";
import { ViewFieldRec } from "app/client/models/entities/ViewFieldRec";
import { menuDivider, menuItemCmd } from "app/client/ui2018/menus";

const t = makeT("FieldContextMenu");

export interface IFieldContextMenu {
  disableModify: boolean;
  isReadonly: boolean;
  field: ViewFieldRec;
  isAddRow: boolean;
}

export function FieldContextMenu(fieldOptions: IFieldContextMenu) {
  const { disableModify, isReadonly, field, isAddRow } = fieldOptions;
  const disableForNoModifyColumn = ariaDisabled(disableModify || isReadonly);
  const disableForReadonlyColumn = ariaDisabled(isReadonly);

  const isVirtual = typeof field.colRef.peek() === "string";
  const disabledForVirtual = ariaDisabled(isVirtual);

  return [
    menuItemCmd(allCommands.contextMenuCut, t("Cut"), disableForNoModifyColumn),
    menuItemCmd(allCommands.contextMenuCopy, t("Copy")),
    menuItemCmd(allCommands.contextMenuPaste, t("Paste"), disableForNoModifyColumn),
    menuDivider(),
    menuItemCmd(allCommands.clearValues, t("Clear field"), disableForNoModifyColumn),
    menuItemCmd(allCommands.hideCardFields, t("Hide field"), disableForReadonlyColumn),
    menuDivider(),
    menuItemCmd(allCommands.openDiscussion, t("Comment"),
      ariaDisabled(isReadonly || isVirtual || isAddRow),
    ),
    menuItemCmd(allCommands.copyLink, t("Copy anchor link"), disabledForVirtual),
  ];
}
