// the list of widget types with their labels and icons
import {ViewSectionRec} from "app/client/models/entities/ViewSectionRec";
import {IPageWidget} from "app/client/ui/PageWidgetPicker";
import {IconName} from "app/client/ui2018/IconList";
import {IWidgetType} from "app/common/widgetTypes";
import {makeT} from 'app/client/lib/localization';

const t = makeT('widgetTypesMap');

export const widgetTypesMap = new Map<IWidgetType, IWidgetTypeInfo>([
  ['record', {name: 'Table', icon: 'TypeTable', getLabel: () => t('Table')}],
  ['single', {name: 'Card', icon: 'TypeCard', getLabel: () => t('Card')}],
  ['detail', {name: 'Card List', icon: 'TypeCardList', getLabel: () => t('Card List')}],
  ['chart', {name: 'Chart', icon: 'TypeChart', getLabel: () => t('Chart')}],
  ['form', {name: 'Form', icon: 'Board', getLabel: () => t('Form')}],
  ['custom', {name: 'Custom', icon: 'TypeCustom', getLabel: () => t('Custom')}],
  ['custom.calendar', {name: 'Calendar', icon: 'TypeCalendar', getLabel: () => t('Calendar')}],
]);

// Widget type info.
export interface IWidgetTypeInfo {
  name: string;
  icon: IconName;
  getLabel: () => string;
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
  let telemetryWidgetType: string | undefined = widgetTypesMap.get(type)?.name;
  if (!telemetryWidgetType) { return undefined; }

  if (options.isNewTable) {
    telemetryWidgetType = 'New ' + telemetryWidgetType;
  }
  if (options.isSummary) {
    telemetryWidgetType += ' (Summary)';
  }

  return telemetryWidgetType;
}
