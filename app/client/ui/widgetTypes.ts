/**
 * Exposes utilities for getting the types information associated to each of the widget types.
 */

import { IconName } from "app/client/ui2018/IconList";

// all widget types
export type IWidgetType = 'record' | 'detail' | 'single' | 'chart' | 'custom';

// Widget type info.
export interface IWidgetTypeInfo {
  label: string;
  icon: IconName;
}

// the list of widget types with their labels and icons
export const widgetTypes = new Map<IWidgetType, IWidgetTypeInfo> ([
  ['record', {label: 'Table', icon: 'TypeTable'}],
  ['single', {label: 'Card', icon: 'TypeCard'}],
  ['detail', {label: 'Card List', icon: 'TypeCardList'}],
  ['chart', {label: 'Chart', icon: 'TypeChart'}],
  ['custom', {label: 'Custom', icon: 'TypeCustom'}]
]);

// Returns the widget type info for sectionType, or the one for 'record' if sectionType is null.
export function getWidgetTypes(sectionType: IWidgetType|null): IWidgetTypeInfo {
  return widgetTypes.get(sectionType || 'record') || widgetTypes.get('record')!;
}
