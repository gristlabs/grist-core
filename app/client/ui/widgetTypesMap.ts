// the list of widget types with their labels and icons
import {ViewSectionRec} from "app/client/models/entities/ViewSectionRec";
import {IPageWidget} from "app/client/ui/PageWidgetPicker";
import {IconName} from "app/client/ui2018/IconList";
import {IWidgetType} from "app/common/widgetTypes";

export const widgetTypesMap = new Map<IWidgetType, IWidgetTypeInfo>([
  ['record', {label: 'Table', icon: 'TypeTable'}],
  ['single', {label: 'Card', icon: 'TypeCard'}],
  ['detail', {label: 'Card List', icon: 'TypeCardList'}],
  ['chart', {label: 'Chart', icon: 'TypeChart'}],
  ['form', {label: 'Form', icon: 'Board'}],
  ['custom', {label: 'Custom', icon: 'TypeCustom'}],
  ['custom.calendar', {label: 'Calendar', icon: 'TypeCalendar'}],
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

export interface GetTelemetryWidgetTypeOptions {
  /** Defaults to `false`. */
  isSummary?: boolean;
  /** Defaults to `false`. */
  isNewTable?: boolean;
}

export function getTelemetryWidgetTypeFromVS(vs: ViewSectionRec) {
  return getTelemetryWidgetType(vs.widgetType.peek(), {
    isSummary: vs.table.peek().summarySourceTable.peek() !== 0,
  });
}

export function getTelemetryWidgetTypeFromPageWidget(widget: IPageWidget) {
  return getTelemetryWidgetType(widget.type, {
    isNewTable: widget.table === 'New Table',
    isSummary: widget.summarize,
  });
}

function getTelemetryWidgetType(type: IWidgetType, options: GetTelemetryWidgetTypeOptions = {}) {
  let telemetryWidgetType: string | undefined = widgetTypesMap.get(type)?.label;
  if (!telemetryWidgetType) { return undefined; }

  if (options.isNewTable) {
    telemetryWidgetType = 'New ' + telemetryWidgetType;
  }
  if (options.isSummary) {
    telemetryWidgetType += ' (Summary)';
  }

  return telemetryWidgetType;
}
