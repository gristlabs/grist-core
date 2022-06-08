import type {AppModel} from 'app/client/models/AppModel';
import {commonUrls} from 'app/common/gristUrls';
import {Disposable} from 'grainjs';

export function buildUpgradeNudge(options: {
  onClose: () => void;
  onUpgrade: () => void
}) {
  return null;
}

export function buildNewSiteModal(owner: Disposable, current: string | null) {
  window.location.href = commonUrls.plans;
}

export function buildUpgradeModal(owner: Disposable, planName: string)  {
  window.location.href = commonUrls.plans;
}

export class UpgradeButton extends Disposable {
  constructor(appModel: AppModel) {
    super();
  }
  public buildDom() {
    return null;
  }
}
