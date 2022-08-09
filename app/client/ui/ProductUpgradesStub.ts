import type {AppModel} from 'app/client/models/AppModel';
import {commonUrls} from 'app/common/gristUrls';
import {Disposable, DomArg, DomContents, IDisposableOwner} from 'grainjs';

export function buildNewSiteModal(context: Disposable, options: {
  planName: string,
  selectedPlan?: string,
  onCreate?: () => void
}) {
  window.location.href = commonUrls.plans;
}

export function buildUpgradeModal(owner: Disposable, planName: string)  {
  window.location.href = commonUrls.plans;
}

export function showTeamUpgradeConfirmation(owner: Disposable) {
}

export interface UpgradeButton  {
  showUpgradeCard(...args: DomArg<HTMLElement>[]): DomContents;
  showUpgradeButton(...args: DomArg<HTMLElement>[]): DomContents;
}

export function buildUpgradeButton(owner: IDisposableOwner, app: AppModel): UpgradeButton {
  return {
    showUpgradeCard : () => null,
    showUpgradeButton : () => null,
  };
}
