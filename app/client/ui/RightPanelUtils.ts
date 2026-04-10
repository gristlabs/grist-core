import { makeT } from "app/client/lib/localization";
import { cssConfigContainer } from "app/client/ui/RightPanelStyles";
import { IconName } from "app/client/ui2018/IconList";
import { IWidgetType } from "app/common/widgetTypes";

import { dom, DomElementArg } from "grainjs";

const rpanelT = makeT("RightPanel");

// Returns the icon and label of a type, default to those associate to 'record' type.
export function getFieldType(widgetType: IWidgetType | null) {
  // A map of widget type to the icon and label to use for a field of that widget.
  const fieldTypes = new Map<IWidgetType, { label: string; icon: IconName; pluralLabel: string; }>([
    ["record", {
      label: rpanelT("columns", { count: 1 }), icon: "TypeCell", pluralLabel: rpanelT("columns", { count: 2 }),
    }],
    ["detail", {
      label: rpanelT("fields", { count: 1 }), icon: "TypeCell", pluralLabel: rpanelT("fields", { count: 2 }),
    }],
    ["single", {
      label: rpanelT("fields", { count: 1 }), icon: "TypeCell", pluralLabel: rpanelT("fields", { count: 2 }),
    }],
    ["chart", {
      label: rpanelT("series", { count: 1 }), icon: "ChartLine", pluralLabel: rpanelT("series", { count: 2 }),
    }],
    ["custom", {
      label: rpanelT("columns", { count: 1 }), icon: "TypeCell", pluralLabel: rpanelT("columns", { count: 2 }),
    }],
    ["form", {
      label: rpanelT("fields", { count: 1 }), icon: "TypeCell", pluralLabel: rpanelT("fields", { count: 2 }),
    }],
  ]);

  return fieldTypes.get(widgetType || "record") || fieldTypes.get("record")!;
}

export function buildConfigContainer(...args: DomElementArg[]): HTMLElement {
  return cssConfigContainer(
    // The `position: relative;` style is needed for the overlay for the readonly mode. Note that
    // we cannot set it on the cssConfigContainer directly because it conflicts with how overflow
    // works. `padding-top: 1px;` prevents collapsing the top margins for the container and the
    // first child.
    dom("div", { style: "position: relative; padding-top: 1px;" }, ...args),
  );
}
