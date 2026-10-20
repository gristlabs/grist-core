import { AccessLevel } from "app/common/CustomWidget";
import { safeJsonParse } from "app/common/gutil";
import { WidgetError } from "app/plugin/WidgetErrors";

import isEmpty from "lodash/isEmpty";
import omit from "lodash/omit";

// The code of a Widget Creator widget is one HTML file in the section's `options.html`, next to
// options like `zebraStripes`. The widget's own options, in `customView.widgetOptions`, can't reach it.

/** The access level of a Widget Creator widget that has none: it reads the rows of its table. */
export const DEFAULT_WIDGET_CREATOR_ACCESS = AccessLevel.read_table;

/** Reads an error the widget page posted (see reportWidgetErrors), or returns null when the message is not one. */
export function parseWidgetError(data: unknown): WidgetError | null {
  const error = (data as any)?.error;
  if (!error || typeof error.message !== "string") { return null; }
  return {
    message: error.message,
    line: typeof error.line === "number" ? error.line : undefined,
    stack: typeof error.stack === "string" ? error.stack : undefined,
  };
}

/**
 * Reads the options of a Custom Widget Builder widget: its code as one file, and the widget's own
 * options without the code. The file is `_html`, with `_js` in a script before `</body>`. The
 * builder loads the plugin API when the HTML does not, so the file loads it too. The code is ""
 * when the widget has none.
 *
 * Any address of the plugin API, like https://docs.getgrist.com/grist-plugin-api.js, is changed
 * to the one Grist serves next to its own files: it works without the internet and has the same
 * version as Grist.
 */
export function readCustomWidgetBuilderOptions(widgetOptions: Record<string, any> | null | undefined) {
  const html = typeof widgetOptions?._html === "string" ? widgetOptions._html : "";
  const js = typeof widgetOptions?._js === "string" ? widgetOptions._js : "";
  const rest = omit(widgetOptions, ["_html", "_js"]);
  return { code: joinBuilderCode(html, js), widgetOptions: isEmpty(rest) ? null : rest };
}

/**
 * Returns a copy of the parsed `options` of a section that becomes a Widget Creator widget. When
 * the type changes, it resets the access, drops the old custom widget, and moves Custom Widget
 * Builder code to `html`.
 */
export function toWidgetCreatorOptions(
  options: Record<string, any>, { typeChanged }: { typeChanged: boolean },
): Record<string, any> {
  const result = structuredClone(options);
  const customView = safeJsonParse(result.customView, {});
  if (typeChanged) {
    const builder = readCustomWidgetBuilderOptions(customView.widgetOptions);
    if (builder.code) {
      result.html = builder.code;
      customView.widgetOptions = builder.widgetOptions;
    }
    customView.access = DEFAULT_WIDGET_CREATOR_ACCESS;
    Object.assign(customView, { url: null, widgetId: null, widgetDef: null, pluginId: "" });
  } else if (!customView.access) {
    customView.access = DEFAULT_WIDGET_CREATOR_ACCESS;
  }
  result.customView = JSON.stringify(customView);
  return result;
}

function joinBuilderCode(html: string, js: string): string {
  if (!html.trim() && !js.trim()) { return ""; }
  html = html.replace(PLUGIN_API_ADDRESS, "$1grist-plugin-api.js$1");
  if (!html.includes("grist-plugin-api.js")) { html = insertAfterHead(html, PLUGIN_API_SCRIPT); }
  if (!js.trim()) { return html; }
  const script = `<script>\n${js}\n</script>\n`;
  const bodyEnd = html.lastIndexOf("</body>");
  return bodyEnd >= 0 ?
    `${html.slice(0, bodyEnd)}${script}${html.slice(bodyEnd)}` :
    `${html}\n${script}`;
}

// Inserts `snippet` after `<head>`, after the doctype, or at the start.
function insertAfterHead(html: string, snippet: string): string {
  const anchor = /<head(\s[^>]*)?>/i.exec(html) || /^\s*<!doctype[^>]*>/i.exec(html);
  const insertAt = anchor ? anchor.index + anchor[0].length : 0;
  return `${html.slice(0, insertAt)}${snippet}${html.slice(insertAt)}`;
}

const PLUGIN_API_SCRIPT = `<script src="grist-plugin-api.js"></script>`;
// An address in quotes that ends with grist-plugin-api.js. $1 is the quote.
const PLUGIN_API_ADDRESS = /(["'])[^"']*grist-plugin-api\.js\1/g;
