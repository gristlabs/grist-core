/**
 * Exposes utilities for getting the types information associated to each of the widget types.
 */
import {StringUnion} from "app/common/StringUnion";

// Custom widgets that are attached to "Add New" menu.
export const AttachedCustomWidgets = StringUnion('custom.calendar');
export type IAttachedCustomWidget = typeof AttachedCustomWidgets.type;

// all widget types
export type IWidgetType = 'record' | 'detail' | 'single' | 'chart' | 'custom' | IAttachedCustomWidget;
