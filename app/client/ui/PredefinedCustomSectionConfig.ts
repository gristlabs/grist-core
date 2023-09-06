import {GristDoc} from "../components/GristDoc";
import {ViewSectionRec} from "../models/entities/ViewSectionRec";
import {CustomSectionConfig} from "./CustomSectionConfig";

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

  protected async _getWidgets(): Promise<void> {
    // Do nothing.
  }
}
