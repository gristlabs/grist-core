import {menuItem, menuSubHeader} from 'app/client/ui2018/menus';

interface IFieldOptions {
  useSeparate: () => void;
  saveAsCommon: () => void;
  revertToCommon: () => void;
}

export function FieldSettingsMenu(useColOptions: boolean, actions: IFieldOptions) {
  return [
    menuSubHeader(`Using ${useColOptions ? 'common' : 'separate'} settings`),
    useColOptions ? menuItem(actions.useSeparate, 'Use separate settings') : [
      menuItem(actions.saveAsCommon, 'Save as common settings'),
      menuItem(actions.revertToCommon, 'Revert to common settings'),
    ]
  ];
}
