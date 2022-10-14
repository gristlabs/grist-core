import {t} from 'app/client/lib/localization';
import {menuItem, menuSubHeader} from 'app/client/ui2018/menus';
import {dom} from 'grainjs';

interface IFieldOptions {
  useSeparate: () => void;
  saveAsCommon: () => void;
  revertToCommon: () => void;
}

const translate = (x: string, args?: any): string => t(`FieldMenus.${x}`, args);

export function FieldSettingsMenu(useColOptions: boolean, disableSeparate: boolean, actions: IFieldOptions) {
  useColOptions = useColOptions || disableSeparate;
  return [
    menuSubHeader(translate('UsingSettings', {context: useColOptions ? 'common' : 'separate'})),
    useColOptions ? menuItem(actions.useSeparate, translate('Settings', {context: 'useseparate'}), dom.cls('disabled', disableSeparate)) : [
      menuItem(actions.saveAsCommon, translate('Settings', {context: 'savecommon'})),
      menuItem(actions.revertToCommon, translate('Settings', {context: 'revertcommon'})),
    ]
  ];
}
