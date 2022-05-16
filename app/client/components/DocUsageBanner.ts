import {buildLimitStatusMessage, buildUpgradeMessage} from 'app/client/components/DocumentUsage';
import {sessionStorageBoolObs} from 'app/client/lib/localStorageObs';
import {DocPageModel} from 'app/client/models/DocPageModel';
import {colors, isNarrowScreenObs} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {Computed, Disposable, dom, DomComputed, makeTestId, Observable, styled} from 'grainjs';

const testId = makeTestId('test-doc-usage-banner-');

export class DocUsageBanner extends Disposable {
  // Whether the banner is vertically expanded on narrow screens.
  private readonly _isExpanded = Observable.create(this, true);

  private readonly _currentDocId = this._docPageModel.currentDocId;
  private readonly _currentDocUsage = this._docPageModel.currentDocUsage;
  private readonly _currentOrg = this._docPageModel.currentOrg;

  private readonly _dataLimitStatus = Computed.create(this, this._currentDocUsage, (_use, usage) => {
    return usage?.dataLimitStatus ?? null;
  });

  private readonly _shouldShowBanner: Computed<boolean> =
    Computed.create(this, this._currentOrg, (_use, org) => {
      return org?.access !== 'guests' && org?.access !== null;
    });

  // Session storage observable. Set to false to dismiss the banner for the session.
  private _showApproachingLimitBannerPref: Observable<boolean>;

  constructor(private _docPageModel: DocPageModel) {
    super();
    this.autoDispose(this._currentDocId.addListener((docId) => {
      if (this._showApproachingLimitBannerPref?.isDisposed() === false) {
        this._showApproachingLimitBannerPref.dispose();
      }
      const userId = this._docPageModel.appModel.currentUser?.id ?? 0;
      this._showApproachingLimitBannerPref = sessionStorageBoolObs(
        `u=${userId}:doc=${docId}:showApproachingLimitBanner`,
        true,
      );
    }));
  }

  public buildDom() {
    return dom.maybe(this._dataLimitStatus, (status): DomComputed => {
      switch (status) {
        case 'approachingLimit': { return this._buildApproachingLimitBanner(); }
        case 'gracePeriod':
        case 'deleteOnly': { return this._buildExceedingLimitBanner(status === 'deleteOnly'); }
      }
    });
  }

  private _buildApproachingLimitBanner() {
    return dom.maybe(this._shouldShowBanner, () => {
      return dom.domComputed(use => {
        if (!use(this._showApproachingLimitBannerPref)) {
          return null;
        }

        const org = use(this._currentOrg);
        if (!org) { return null; }

        const features = org.billingAccount?.product.features;
        return cssApproachingLimitBanner(
          cssBannerMessage(
            cssWhiteIcon('Idea'),
            cssLightlyBoldedText(
              buildLimitStatusMessage('approachingLimit', features),
              ' ',
              buildUpgradeMessage(org.access === 'owners'),
              testId('text'),
            ),
          ),
          cssCloseButton('CrossBig',
            dom.on('click', () => this._showApproachingLimitBannerPref.set(false)),
            testId('close'),
          ),
          testId('container'),
        );
      });
    });
  }

  private _buildExceedingLimitBanner(isDeleteOnly: boolean) {
    return dom.maybe(this._shouldShowBanner, () => {
      return dom.maybe(this._currentOrg, org => {
        const features = org.billingAccount?.product.features;
        return cssExceedingLimitBanner(
          cssBannerMessage(
            cssWhiteIcon('Idea'),
            cssLightlyBoldedText(
              dom.domComputed(use => {
                const isExpanded = use(this._isExpanded);
                const isNarrowScreen = use(isNarrowScreenObs());
                const isOwner = org.access === 'owners';
                if (isNarrowScreen && !isExpanded) {
                  return buildUpgradeMessage(isOwner, 'short');
                }

                return [
                  buildLimitStatusMessage(isDeleteOnly ? 'deleteOnly' : 'gracePeriod', features),
                  ' ',
                  buildUpgradeMessage(isOwner),
                ];
              }),
              testId('text'),
            ),
          ),
          dom.maybe(isNarrowScreenObs(), () => {
            return dom.domComputed(this._isExpanded, isExpanded =>
              cssExpandButton(
                isExpanded ? 'DropdownUp' : 'Dropdown',
                dom.on('click', () => this._isExpanded.set(!isExpanded)),
              ),
            );
          }),
          testId('container'),
        );
      });
    });
  }
}

const cssLightlyBoldedText = styled('div', `
  font-weight: 500;
`);

const cssUsageBanner = styled('div', `
  display: flex;
  align-items: flex-start;
  padding: 10px;
  color: white;
  gap: 16px;
`);

const cssApproachingLimitBanner = styled(cssUsageBanner, `
  background: #E6A117;
`);

const cssExceedingLimitBanner = styled(cssUsageBanner, `
  background: ${colors.error};
`);

const cssIconAndText = styled('div', `
  display: flex;
  gap: 16px;
`);

const cssBannerMessage = styled(cssIconAndText, `
  flex-grow: 1;
  justify-content: center;
`);

const cssIcon = styled(icon, `
  flex-shrink: 0;
  width: 16px;
  height: 16px;
`);

const cssWhiteIcon = styled(cssIcon, `
  background-color: white;
`);

const cssCloseButton = styled(cssIcon, `
  flex-shrink: 0;
  cursor: pointer;
  background-color: white;
`);

const cssExpandButton = cssCloseButton;
