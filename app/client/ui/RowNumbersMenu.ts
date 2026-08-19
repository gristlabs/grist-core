import { makeT } from "app/client/lib/localization";
import { RowNumbersMode, ViewSectionRec } from "app/client/models/entities/ViewSectionRec";
import { reportError } from "app/client/models/errors";
import { withInfoTooltip } from "app/client/ui/tooltips";
import { testId, theme } from "app/client/ui2018/cssVars";
import { icon } from "app/client/ui2018/icons";
import { IOptionFull, menuItem, menuSubHeader } from "app/client/ui2018/menus";

import { DomElementArg, styled } from "grainjs";
import * as weasel from "popweasel";

// rowNumbersMenu used to be exported from GridViewMenus.ts.
// eslint-disable-next-line local/makeT-filename
const t = makeT("GridViewMenus");

/**
 * Menu to choose what the row-number gutter shows, opened from the grid's top-left corner and
 * from the widget panel's "Show [row numbers]" link (which omits the Hidden mode — the panel's
 * checkbox covers hiding). The active mode is marked with a green tick.
 */
export function rowNumbersMenu(viewSection: ViewSectionRec, { includeHidden = true } = {}): DomElementArg[] {
  const modes: IOptionFull<RowNumbersMode>[] = [
    { value: "number", label: t("Numbers") },
    { value: "rowId", label: t("Row IDs") },
    ...(includeHidden ? [{ value: "hidden" as const, label: t("Hidden") }] : []),
  ];
  const options = viewSection.optionsObj;
  const setMode = (rowNumbers: RowNumbersMode) => {
    if (options.peek().rowNumbers !== rowNumbers) {
      options.setAndSaveOrRevert({ ...options.peek(), rowNumbers }).catch(reportError);
    }
  };
  return [
    menuSubHeader(t("Row numbers")),
    ...modes.map(({ value, label }) => menuItem(() => setMode(value),
      cssTickSlot(options.peek().rowNumbers === value ? icon("Tick", testId("row-numbers-selected")) : null),
      value === "rowId" ? withInfoTooltip(label, "rowIds", { variant: "hover" }) : label,
    )),
  ];
}

// A menuIcon-sized slot for the tick marking the active mode, rendered (empty) on every item so
// that the labels align. The tick turns white while its item is selected, to stay visible.
const cssTickSlot = styled("div", `
  flex: none;
  width: 16px;
  margin-right: 8px;
  --icon-color: ${theme.controlFg};
  .${weasel.cssMenuItem.className}-sel & {
    --icon-color: ${theme.menuItemSelectedFg};
  }
`);
