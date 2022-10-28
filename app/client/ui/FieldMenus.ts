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
    menuSubHeader(t('UsingSettings', {context: useColOptions ? 'common' : 'separate'})),
    useColOptions ? menuItem(actions.useSeparate, t('Settings', {context: 'useseparate'}), dom.cls('disabled', disableSeparate)) : [
      menuItem(actions.saveAsCommon, t('Settings', {context: 'savecommon'})),
      menuItem(actions.revertToCommon, t('Settings', {context: 'revertcommon'})),
    ]
  ];
}
