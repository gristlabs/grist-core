// the list of widget types with their labels and icons
import {IWidgetType} from "app/common/widgetTypes";
import {IconName} from "app/client/ui2018/IconList";

export const widgetTypesMap = new Map<IWidgetType, IWidgetTypeInfo>([
  ['record', {label: 'Table', icon: 'TypeTable'}],
  ['single', {label: 'Card', icon: 'TypeCard'}],
  ['detail', {label: 'Card List', icon: 'TypeCardList'}],
  ['chart', {label: 'Chart', icon: 'TypeChart'}],
  ['custom', {label: 'Custom', icon: 'TypeCustom'}],
  ['custom.calendar', {label: 'Calendar', icon: 'FieldDate'}]
]);

// Widget type info.
export interface IWidgetTypeInfo {
  label: string;
  icon: IconName;
}

// Returns the widget type info for sectionType, or the one for 'record' if sectionType is null.
export function getWidgetTypes(sectionType: IWidgetType | null): IWidgetTypeInfo {
  return widgetTypesMap.get(sectionType || 'record') || widgetTypesMap.get('record')!;
}
