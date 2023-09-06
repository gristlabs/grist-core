import {AccessLevel} from "app/common/CustomWidget";
import {ViewSectionRec} from "app/client/models/entities/ViewSectionRec";
import {CustomView} from "app/client/components/CustomView";
import {GristDoc} from "app/client/components/GristDoc";

//Abstract class for more future inheritances
abstract class CustomAttachedView extends CustomView {
  public override create(gristDoc: GristDoc, viewSectionModel: ViewSectionRec) {
    super.create(gristDoc, viewSectionModel);
    void viewSectionModel.customDef.access.setAndSave(AccessLevel.full);

    const widgetsApi = this.gristDoc.app.topAppModel.api;
    widgetsApi.getWidgets().then(async result=>{
      const widget = result.find(w=>w.name == this.getWidgetName());
      if(widget) {
        await this.customDef.url.setAndSave(widget.url);
      }
    }).catch(()=>{
      //do nothing
    });
  }

  protected abstract getWidgetName(): string;

}

export class CustomCalendarView extends CustomAttachedView {
  protected getWidgetName(): string {
    return "Calendar";
  }
}
