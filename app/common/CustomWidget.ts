/**
 * Custom widget manifest definition.
 */
export interface ICustomWidget {
  /**
   * Widget friendly name, used on the UI.
   */
  name: string;
  /**
   * Widget unique id, probably in npm package format @gristlabs/custom-widget-name.
   */
  widgetId: string;
  /**
   * Custom widget main page URL.
   */
  url: string;
  /**
   * Optional desired access level.
   */
  accessLevel?: AccessLevel;
  /**
   * If set, Grist will render the widget after `grist.ready()`.
   *
   * Currently, this is only used to defer rendering a widget until it has had
   * a chance to apply the Grist theme.
   */
  renderAfterReady?: boolean;
}

/**
 * Widget access level.
 */
export enum AccessLevel {
  /**
   * Default, no access to Grist.
   */
  none = "none",
  /**
   * Read only access to table the widget is based on.
   */
  read_table = "read table",
  /**
   * Full access to document on user's behalf.
   */
  full = "full",
}

export function isSatisfied(current: AccessLevel, minimum: AccessLevel) {
  function ordered(level: AccessLevel) {
    switch(level) {
      case AccessLevel.none: return 0;
      case AccessLevel.read_table: return 1;
      case AccessLevel.full: return 2;
      default: throw new Error(`Unrecognized access level ${level}`);
    }
  }
  return ordered(current) >= ordered(minimum);
}
