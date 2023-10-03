// import {AccessLevel} from "app/common/CustomWidget";
// import {ViewSectionRec} from "app/client/models/entities/ViewSectionRec";
import { CustomView, CustomViewSettings } from "app/client/components/CustomView";
import { AccessLevel } from "app/common/CustomWidget";
// import {GristDoc} from "app/client/components/GristDoc";
// import {reportError} from 'app/client/models/errors';

//Abstract class for more future inheritances
// abstract class CustomAttachedView extends CustomView {
  /*
  public override create(gristDoc: GristDoc, viewSectionModel: ViewSectionRec) {
    super.create(gristDoc, viewSectionModel);
    if (viewSectionModel.customDef.access.peek() !== AccessLevel.full) {
      void viewSectionModel.customDef.access.setAndSave(AccessLevel.full).catch((err)=>{
        if (err?.code === "ACL_DENY") {
          // do nothing, we might be in a readonly mode.
          return;
        }
        reportError(err);
      });
    }

    const widgetsApi = this.gristDoc.app.topAppModel;
    widgetsApi.getWidgets().then(async result=>{
      const widget = result.find(w=>w.name == this.getWidgetName());
      if (widget && this.customDef.url.peek() !== widget.url) {
        await this.customDef.url.setAndSave(widget.url);
      }
    }).catch((err)=>{
      if (err?.code !== "ACL_DENY") {
        // TODO: revisit it later. getWidgets() is async call, and non of the code
        // above is checking if we are still alive.
        console.error(err);
      } else {
        // do nothing, we might be in a readonly mode.
      }
    });
  }
  */

//  protected abstract getWidgetName(): string;

// }

export class CustomCalendarView extends CustomView {
  protected getInitialSettings(): CustomViewSettings {
    return {
      widgetId: '@gristlabs/widget-calendar',
      accessLevel: AccessLevel.full,
    };
  }
}
