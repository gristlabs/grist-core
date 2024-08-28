import {GristDoc} from 'app/client/components/GristDoc';
import {ViewSectionRec} from 'app/client/models/entities/ViewSectionRec';
import {CustomSectionConfig} from 'app/client/ui/CustomSectionConfig';
import {ICustomWidget} from 'app/common/CustomWidget';

export class PredefinedCustomSectionConfig extends CustomSectionConfig {


  constructor(section: ViewSectionRec, gristDoc: GristDoc) {
    super(section, gristDoc);
  }

  public buildDom() {
    return this._customSectionConfigurationConfig.buildDom();
  }

  protected shouldRenderWidgetSelector(): boolean {
    return false;
  }

  protected async _getWidgets(): Promise<ICustomWidget[]> {
    return [];
  }
}
