import sortBy = require('lodash/sortBy');

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
   *
   * There could be multiple versions of the same widget with the
   * same id, e.g. a bundled version and an external version.
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
   * This is used to defer showing a widget on initial load until it has finished
   * applying the Grist theme.
   */
  renderAfterReady?: boolean;

  /**
   * If set to false, do not offer to user in UI.
   */
  published?: boolean;

  /**
   * If the widget came from a plugin, we track that here.
   */
  source?: {
    pluginId: string;
    name: string;
  };
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

/**
 * Find the best match for a widgetId/pluginId combination among the
 * given widgets. An exact widgetId match is required. A pluginId match
 * is preferred but not required.
 */
export function matchWidget(widgets: ICustomWidget[], options: {
  widgetId: string,
  pluginId?: string,
}): ICustomWidget|undefined {
  const prefs = sortBy(widgets, (w) => {
    return [w.widgetId !== options.widgetId,
            (w.source?.pluginId||'') !== options.pluginId];
  });
  if (prefs.length === 0) { return; }
  if (prefs[0].widgetId !== options.widgetId) { return; }
  return prefs[0];
}
