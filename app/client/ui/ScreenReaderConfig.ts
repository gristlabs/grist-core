import { allCommands } from "app/client/components/commands";
import { makeT } from "app/client/lib/localization";
import { AppModel } from "app/client/models/AppModel";
import * as css from "app/client/ui/AccountPageCss";
import { labeledSquareCheckbox } from "app/client/ui2018/checkbox";

import { Computed, Disposable, dom, makeTestId } from "grainjs";

const testId = makeTestId("test-screen-reader-config-");
const t = makeT("ScreenReaderConfig");

export class ScreenReaderConfig extends Disposable {
  private _screenReaderMode = Computed.create(
    this, this._appModel.screenReaderMode, (_use, val) => val,
  ).onWrite(value => this._appModel.screenReaderMode.set(value));

  constructor(private _appModel: AppModel) {
    super();
  }

  public buildDom() {
    return dom("div",
      css.dataRow(
        labeledSquareCheckbox(
          this._screenReaderMode,
          t("Enable screen reader improvements"),
          testId("checkbox"),
          { "aria-describedby": "screen-reader-mode-description" },
        ),
      ),
      css.description(
        t("Press {{accessibilityModalShortcut}} for more information about screen reader navigation.", {
          accessibilityModalShortcut: allCommands.accessibility.humanKeys,
        }),
        { id: "screen-reader-mode-description" },
      ),
      testId("container"),
    );
  }
}
