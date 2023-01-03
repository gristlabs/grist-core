import {makeT} from 'app/client/lib/localization';
import {menuItem, menuSubHeader} from 'app/client/ui2018/menus';
import {dom} from 'grainjs';

interface IFieldOptions {
  useSeparate: () => void;
  saveAsCommon: () => void;
  revertToCommon: () => void;
}

const t = makeT('FieldMenus');

export function FieldSettingsMenu(useColOptions: boolean, disableSeparate: boolean, actions: IFieldOptions) {
  useColOptions = useColOptions || disableSeparate;
  return [
    menuSubHeader(useColOptions ? t("Using common settings") : t("Using separate settings")),
    useColOptions ? menuItem(actions.useSeparate, t("Use separate settings"), dom.cls('disabled', disableSeparate)) : [
      menuItem(actions.saveAsCommon, t("Save as common settings")),
      menuItem(actions.revertToCommon, t("Revert to common settings")),
    ]
  ];
}
