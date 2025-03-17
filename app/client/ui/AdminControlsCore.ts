import {dom, MultiHolder, Observable} from 'grainjs';
import type {AppModel} from 'app/client/models/AppModel';
import * as css from 'app/client/ui/LeftPanelCommon';
import {PageSidePanel} from 'app/client/ui/PagePanels';
import {AppHeader} from 'app/client/ui/AppHeader';

export function buildLeftPanel(owner: MultiHolder, appModel: AppModel): PageSidePanel {
  return {
    header: dom.create(AppHeader, appModel),
    panelWidth: Observable.create(owner, 240),
    panelOpen: Observable.create(owner, false),
    content: css.leftPanelBasic(appModel, Observable.create(owner, false)),
    hideOpener: true,
  };
}

export function buildAdminData(owner: MultiHolder, appModel: AppModel) {
  return null;
}

export function hasAdminTools() {
  return false;
}
