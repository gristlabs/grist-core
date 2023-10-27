import { CustomView, CustomViewSettings } from "app/client/components/CustomView";
import { AccessLevel } from "app/common/CustomWidget";

export class CustomCalendarView extends CustomView {
  protected getBuiltInSettings(): CustomViewSettings {
    return {
      widgetId: '@gristlabs/widget-calendar',
      accessLevel: AccessLevel.full,
    };
  }
}
