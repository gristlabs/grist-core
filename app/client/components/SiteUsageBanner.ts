import {Banner, buildBannerMessage} from 'app/client/components/Banner';
import {buildUpgradeMessage} from 'app/client/components/DocumentUsage';
import {sessionStorageBoolObs} from 'app/client/lib/localStorageObs';
import {AppModel} from 'app/client/models/AppModel';
import {isFreeProduct} from 'app/common/Features';
import {isOwner} from 'app/common/roles';
import {Disposable, dom, makeTestId, Observable} from 'grainjs';

const testId = makeTestId('test-site-usage-banner-');

export class SiteUsageBanner extends Disposable {
  private readonly _currentOrg = this._app.currentOrg;
  private readonly _currentOrgUsage = this._app.currentOrgUsage;
  private readonly _product = this._currentOrg?.billingAccount?.product;
  private readonly _currentUser = this._app.currentValidUser;

  // Session storage observable. Set to false to dismiss the banner for the session.
  private _showApproachingLimitBannerPref?: Observable<boolean>;

  constructor(private _app: AppModel) {
    super();

    if (this._currentUser && isOwner(this._currentOrg)) {
      this._showApproachingLimitBannerPref = this.autoDispose(sessionStorageBoolObs(
        `u=${this._currentUser.id}:org=${this._currentOrg.id}:showApproachingLimitBanner`,
        true,
      ));
    }
  }

  public buildDom() {
    return dom.maybe(this._currentOrgUsage, (usage) => {
      const {approachingLimit, gracePeriod, deleteOnly} = usage;
      if (deleteOnly > 0 || gracePeriod > 0) {
        return this._buildExceedingLimitsBanner(deleteOnly + gracePeriod);
      } else if (approachingLimit > 0) {
        return this._buildApproachingLimitsBanner(approachingLimit);
      } else {
        return null;
      }
    });
  }

  private _buildApproachingLimitsBanner(numDocs: number) {
    return dom.domComputed(use => {
      if (this._showApproachingLimitBannerPref && !use(this._showApproachingLimitBannerPref)) {
        return null;
      }

      const limitsMessage = numDocs > 1
        ? `${numDocs} documents are approaching their limits.`
        : `${numDocs} document is approaching its limits.`;
      return dom.create(Banner, {
        content: buildBannerMessage(
          limitsMessage,
          (this._product && isFreeProduct(this._product)
            ? [' ', buildUpgradeMessage(true)]
            : null
          ),
          testId('text'),
        ),
        style: 'warning',
        showCloseButton: true,
        onClose: () => this._showApproachingLimitBannerPref?.set(false),
      });
    });
  }

  private _buildExceedingLimitsBanner(numDocs: number) {
    const limitsMessage = numDocs > 1
      ? `${numDocs} documents have exceeded their limits.`
      : `${numDocs} document has exceeded its limits.`;
    return dom.create(Banner, {
      content: buildBannerMessage(
        limitsMessage,
        (this._product && isFreeProduct(this._product)
          ? [' ', buildUpgradeMessage(true)]
          : null
        ),
        testId('text'),
      ),
      contentSmall: buildBannerMessage(
        (this._product && isFreeProduct(this._product)
          ? buildUpgradeMessage(true, 'short')
          : limitsMessage
        ),
      ),
      style: 'error',
      showCloseButton: false,
      showExpandButton: true,
    });
  }
}
