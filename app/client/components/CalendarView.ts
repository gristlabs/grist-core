import BaseView from "app/client/components/BaseView";
import { GristDoc } from "app/client/components/GristDoc";
import { makeT } from "app/client/lib/localization";
import { ViewSectionRec } from "app/client/models/DocModel";
import { theme } from "app/client/ui2018/cssVars";

import { dom, makeTestId, styled } from "grainjs";

const t = makeT("CalendarView");
const testId = makeTestId("test-calendar-");

/**
 * Native calendar view. First iteration: renders a placeholder in the section so the widget can be
 * added and seen. Data, config, toolbar and the real grid come in later iterations.
 */
export class CalendarView extends BaseView {
  constructor(gristDoc: GristDoc, viewSectionModel: ViewSectionRec) {
    super(gristDoc, viewSectionModel);

    // .viewPane is what ViewLayout inserts into the document.
    this.viewPane = cssCalendarView(
      testId("container"),
      cssPlaceholder(t("Calendar view - work in progress"), testId("placeholder")),
    );
    this.onDispose(() => {
      dom.domDispose(this.viewPane);
      this.viewPane.remove();
    });
  }
}

const cssCalendarView = styled("div", `
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  width: 100%;
  background-color: ${theme.mainPanelBg};
  color: ${theme.text};
`);

const cssPlaceholder = styled("div", `
  color: ${theme.lightText};
  font-size: 15px;
`);
