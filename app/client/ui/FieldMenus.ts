import {menuItem, menuSubHeader} from 'app/client/ui2018/menus';
import {dom} from 'grainjs';

interface IFieldOptions {
  useSeparate: () => void;
  saveAsCommon: () => void;
  revertToCommon: () => void;
}

export function FieldSettingsMenu(useColOptions: boolean, disableSeparate: boolean, actions: IFieldOptions) {
  useColOptions = useColOptions || disableSeparate;
  return [
    menuSubHeader(`Using ${useColOptions ? 'common' : 'separate'} settings`),
    useColOptions ? menuItem(actions.useSeparate, 'Use separate settings', dom.cls('disabled', disableSeparate)) : [
      menuItem(actions.saveAsCommon, 'Save as common settings'),
      menuItem(actions.revertToCommon, 'Revert to common settings'),
    ]
  ];
}
