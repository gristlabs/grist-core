/**
 * API definitions for CustomSection plugins.
 */

export interface ColumnToMap {
  /**
   * Column name that Widget expects. Must be a valid JSON property name.
   */
  name: string;
  /**
   * Title or short description of a column (used as a label in section mapping).
   */
  title?: string|null,
  /**
   * Optional long description of a column (used as a help text in section mapping).
   */
  description?: string|null,
  /**
   * Column type, by default ANY.
   */
  type?: string, // GristType, TODO: ts-interface-checker doesn't know how to parse this
  /**
   * Mark column as optional all columns are required by default.
   */
  optional?: boolean
  /**
   * Allow multiple column assignment, the result will be list of mapped table column names.
   */
  allowMultiple?: boolean,
}

export type ColumnsToMap = (string|ColumnToMap)[];

/**
 * Initial message sent by the CustomWidget with initial requirements.
 */
export interface InteractionOptionsRequest {
  /**
   * Required access level. If it wasn't granted already, Grist will prompt user to change the current access
   * level.
   */
  requiredAccess?: string,
  /**
   * Instructs Grist to show additional menu options that will trigger onEditOptions callback, that Widget
   * can use to show custom options screen.
   */
  hasCustomOptions?: boolean,
  /**
   * Tells Grist what columns Custom Widget expects and allows user to map between existing column names
   * and those requested by Custom Widget.
   */
  columns?: ColumnsToMap,
}

/**
 * Widget configuration set and approved by Grist, sent as part of ready message.
 */
export interface InteractionOptions{
  /**
   * Granted access level.
   */
   accessLevel: string,
}

/**
 * Current columns mapping between viewFields in section and Custom widget.
 */
export interface WidgetColumnMap {
  [key: string]: string|string[]|null
}

export interface CustomSectionAPI {
  /**
   * Initial request from a Custom Widget that wants to declare its requirements.
   */
  configure(customOptions: InteractionOptionsRequest): Promise<void>;
  /**
   * Returns current widget configuration (if requested through configuration method).
   */
  mappings(): Promise<WidgetColumnMap|null>;
}
