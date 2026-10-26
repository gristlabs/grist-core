import { GristDoc } from "app/client/components/GristDoc";
import { makeT } from "app/client/lib/localization";
import { ViewSectionRec } from "app/client/models/DocModel";
import { CustomSectionConfig } from "app/client/ui/CustomSectionConfig";
import { cssGroupLabel } from "app/client/ui/RightPanelStyles";
import { testId, theme, vars } from "app/client/ui2018/cssVars";
import { icon } from "app/client/ui2018/icons";
import { menuDivider, menuIcon, menuItem } from "app/client/ui2018/menus";
import { WidgetType } from "app/common/widgetTypes";

import { Disposable, dom, DomContents, DomElementArg, styled } from "grainjs";

import type { WidgetCreatorView } from "app/client/components/WidgetCreatorView";

const t = makeT("WidgetCreatorSectionConfig");

/** The creator panel of a Widget Creator widget: the WIDGET group, the access level and the column mapping. */
export class WidgetCreatorSectionConfig extends Disposable {
  constructor(private _section: ViewSectionRec, private _gristDoc: GristDoc) {
    super();
  }

  public buildDom(): DomContents {
    return [
      dom.domComputed(use => use(this._section.viewInstance), (viewInstance) => {
        if (this._section.parentKey.peek() !== WidgetType.Creator || !viewInstance) { return null; }
        const view = viewInstance as WidgetCreatorView;
        return [
          cssGroupLabel(t("WIDGET")),
          cssName(t("In-document custom widget")),
          cssDescription(t("Its code is saved in this document, so copies and exports keep it.")),
          dom.maybe(use => view.hasAssistant && use(view.canEdit), () => cssRowItem(
            icon("Sparkle"),
            t("Ask assistant"),
            dom.on("click", () => view.onAskAssistantClicked()),
            testId("widget-creator-panel-assistant"),
          )),
          dom.maybe(view.canEdit, () => cssRowItem(
            icon("Code"),
            dom.text(use => use(view.editing) ? t("Close editor") : t("Edit code")),
            dom.on("click", () => view.onEditCodeClicked()),
            testId("widget-creator-panel-edit"),
          )),
          cssRowsEnd(),
        ];
      }),
      dom.create(WidgetCreatorAccessConfig, this._section, this._gristDoc),
    ];
  }
}

/** The Widget Creator items on top of the section menu, for editors only. */
export function widgetCreatorMenuItems(view: WidgetCreatorView): DomElementArg[] {
  if (!view.canEdit.get()) { return []; }
  const items: DomElementArg[] = [];
  if (view.editing.get()) {
    items.push(menuItem(() => view.onCloseClicked(), menuIcon("Code"), t("Close editor"),
      testId("widget-creator-menu-close")));
  } else {
    if (view.hasAssistant) {
      items.push(menuItem(() => view.onAskAssistantClicked(), menuIcon("Sparkle"), t("Use assistant"),
        testId("widget-creator-menu-assistant")));
    }
    items.push(menuItem(() => view.onEditSourceClicked(), menuIcon("Code"), t("Edit source"),
      testId("widget-creator-menu-edit")));
  }
  items.push(menuDivider());
  return items;
}

// The custom widget config without the widget selector.
class WidgetCreatorAccessConfig extends CustomSectionConfig {
  protected override shouldRenderWidgetSelector(): boolean {
    return false;
  }

  protected override async _getWidgets() {
    return [];
  }
}

const cssRowsEnd = styled("div", `
  height: 8px;
`);

const cssName = styled("div", `
  margin: 0 16px 4px 16px;
  font-weight: 600;
  color: ${theme.text};
`);

const cssDescription = styled("div", `
  margin: 0 16px 4px 16px;
  color: ${theme.text};
`);

const cssRowItem = styled("div", `
  display: flex;
  align-items: center;
  gap: 10px;
  height: 32px;
  margin: 0 8px;
  padding: 0 8px;
  border-radius: 3px;
  font-size: ${vars.mediumFontSize};
  cursor: pointer;
  color: ${theme.controlFg};
  --icon-color: ${theme.controlFg};
  &:hover {
    color: ${theme.controlHoverFg};
    --icon-color: ${theme.controlHoverFg};
  }
`);
