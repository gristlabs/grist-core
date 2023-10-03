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
   * Currently, this is only used to defer rendering a widget until it has had
   * a chance to apply the Grist theme.
   */
  renderAfterReady?: boolean;

  fromPlugin?: string;
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

export function matchWidget(widgets: ICustomWidget[], options: {
  widgetId?: string,
  pluginId?: string,
}): ICustomWidget|undefined {
  console.log("MATCHING", {
    widgets,
    options,
  });
  const prefs = sortBy(widgets, (w) => {
    return [w.widgetId !== options.widgetId,
            (w.fromPlugin||'') !== options.pluginId]
  });
  if (prefs.length === 0) { return; }
  if (options.widgetId && prefs[0].widgetId !== options.widgetId) {
    return;
  }
  console.log("ORDERED", prefs);
  console.log("MATCHED", prefs[0]);
  return prefs[0];
}

export function filterWidgets(widgets: ICustomWidget[], options: {
  preferPlugin?: boolean,
  keepWidgetIdUnique?: boolean,
}) {
  const folders = new Map<string, ICustomWidget[]>();
  for (const widget of widgets) {
    const widgetId = widget.widgetId;
    if (!folders.has(widgetId)) { folders.set(widgetId, []); }
    const widgetFolder = folders.get(widgetId)!;
    widgetFolder.push(widget);
  }
  let finalResults: ICustomWidget[] = widgets;
  if (options.preferPlugin !== undefined) {
    const results = [];
    const seen = new Set<string>();
    for (const widget of widgets) {
      const folder = folders.get(widget.widgetId)!;
      if (folder.length === 1) {
        results.push(widget);
        continue;
      }
      if (seen.has(widget.widgetId)) { continue; }
      seen.add(widget.widgetId);
      const folderSorted = sortBy(folder, (w) => Boolean(w.fromPlugin) !== options.preferPlugin);
      results.push(folderSorted[0]!);
    }
    finalResults = results;
  }
  if (options.keepWidgetIdUnique) {
    const results = [];
    const seen = new Set<string>();
    for (const widget of widgets) {
      if (seen.has(widget.widgetId)) { continue; }
      seen.add(widget.widgetId);
      results.push(widget);
    }
    finalResults = results;
  }
  return finalResults;
}
