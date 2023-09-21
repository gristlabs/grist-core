import {makeT} from 'app/client/lib/localization';
import {localStorageObs} from 'app/client/lib/localStorageObs';
import {getStorage} from 'app/client/lib/storage';
import {tokenFieldStyles} from 'app/client/lib/TokenField';
import {AppModel} from 'app/client/models/AppModel';
import {urlState} from 'app/client/models/gristUrlState';
import {TelemetryModel, TelemetryModelImpl} from 'app/client/models/TelemetryModel';
import {bigPrimaryButton} from 'app/client/ui2018/buttons';
import {colors, isNarrowScreenObs, theme, vars} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {cssLink} from 'app/client/ui2018/links';
import {commonUrls} from 'app/common/gristUrls';
import {getGristConfig} from 'app/common/urlUtils';
import {Disposable, dom, makeTestId, Observable, styled} from 'grainjs';

const testId = makeTestId('test-support-grist-nudge-');

const t = makeT('SupportGristNudge');

type ButtonState =
  | 'collapsed'
  | 'expanded';

type CardPage =
  | 'support-grist'
  | 'opted-in';

/**
 * Nudges users to support Grist by opting in to telemetry.
 *
 * This currently includes a button that opens a card with the nudge.
 * The button is hidden when the card is visible, and vice versa.
 */
export class SupportGristNudge extends Disposable {
  private readonly _telemetryModel: TelemetryModel = new TelemetryModelImpl(this._appModel);

  private readonly _buttonState: Observable<ButtonState>;
  private readonly _currentPage: Observable<CardPage>;
  private readonly _isClosed: Observable<boolean>;

  constructor(private _appModel: AppModel) {
    super();
    if (!this._shouldShowCardOrButton()) { return; }

    this._buttonState = localStorageObs(
      `u=${this._appModel.currentValidUser?.id ?? 0};supportGristNudge`, 'expanded'
    ) as Observable<ButtonState>;
    this._currentPage = Observable.create(null, 'support-grist');
    this._isClosed = Observable.create(this, false);
  }

  public showButton() {
    if (!this._shouldShowCardOrButton()) { return null; }

    return dom.maybe(
      use => !use(isNarrowScreenObs()) && (use(this._buttonState) === 'collapsed' && !use(this._isClosed)),
      () => this._buildButton()
    );
  }

  public showCard() {
    if (!this._shouldShowCardOrButton()) { return null; }

    return dom.maybe(
      use => !use(isNarrowScreenObs()) && (use(this._buttonState) === 'expanded' && !use(this._isClosed)),
      () => this._buildCard()
    );
  }

  private _markAsDismissed() {
    this._appModel.dismissedPopup('supportGrist').set(true);
    getStorage().removeItem(
      `u=${this._appModel.currentValidUser?.id ?? 0};supportGristNudge`);

  }

  private _close() {
    this._isClosed.set(true);
  }

  private _dismissAndClose() {
    this._markAsDismissed();
    this._close();
  }

  private _shouldShowCardOrButton() {
    if (this._appModel.dismissedPopups.get().includes('supportGrist')) {
      return false;
    }

    const {activation, deploymentType, telemetry} = getGristConfig();
    if (deploymentType !== 'core' || !activation?.isManager) {
      return false;
    }

    if (telemetry && telemetry.telemetryLevel !== 'off') {
      return false;
    }

    return true;
  }

  private _buildButton() {
    return cssContributeButton(
      cssButtonIconAndText(
        icon('Fireworks'),
        t('Contribute'),
      ),
      cssContributeButtonCloseButton(
        icon('CrossSmall'),
        dom.on('click', (ev) => {
          ev.stopPropagation();
          this._dismissAndClose();
        }),
        testId('contribute-button-close'),
      ),
      dom.on('click', () => { this._buttonState.set('expanded'); }),
      testId('contribute-button'),
    );
  }

  private _buildCard() {
    return cssCard(
      dom.domComputed(this._currentPage, page => {
        if (page === 'support-grist') {
          return this._buildSupportGristCardContent();
        } else {
          return this._buildOptedInCardContent();
        }
      }),
      testId('card'),
    );
  }

  private _buildSupportGristCardContent() {
    return [
      cssCloseButton(
        icon('CrossBig'),
        dom.on('click', () => this._buttonState.set('collapsed')),
        testId('card-close'),
      ),
      cssLeftAlignedHeader(t('Support Grist')),
      cssParagraph(t(
        'Opt in to telemetry to help us understand how the product ' +
        'is used, so that we can prioritize future improvements.'
      )),
      cssParagraph(
        t(
          'We only collect usage statistics, as detailed in our {{helpCenterLink}}, never ' +
          'document contents. Opt out any time from the {{supportGristLink}} in the user menu.',
          {
            helpCenterLink: helpCenterLink(),
            supportGristLink: supportGristLink(),
          },
        ),
      ),
      cssFullWidthButton(
        t('Opt in to Telemetry'),
        dom.on('click', () => this._optInToTelemetry()),
        testId('card-opt-in'),
      ),
    ];
  }

  private _buildOptedInCardContent() {
    return [
      cssCloseButton(
        icon('CrossBig'),
        dom.on('click', () => this._close()),
        testId('card-close-icon-button'),
      ),
      cssCenteredFlex(cssSparks()),
      cssCenterAlignedHeader(t('Opted In')),
      cssParagraph(
        t(
          'Thank you! Your trust and support is greatly appreciated. ' +
          'Opt out any time from the {{link}} in the user menu.',
          {link: supportGristLink()},
        ),
      ),
      cssCenteredFlex(
        cssPrimaryButton(
          t('Close'),
          dom.on('click', () => this._close()),
          testId('card-close-button'),
        ),
      ),
    ];
  }

  private async _optInToTelemetry() {
    await this._telemetryModel.updateTelemetryPrefs({telemetryLevel: 'limited'});
    this._currentPage.set('opted-in');
    this._markAsDismissed();
  }
}

function helpCenterLink() {
  return cssLink(
    t('Help Center'),
    {href: commonUrls.helpTelemetryLimited, target: '_blank'},
  );
}

function supportGristLink() {
  return cssLink(
    t('Support Grist page'),
    {href: urlState().makeUrl({supportGrist: 'support-grist'}), target: '_blank'},
  );
}

const cssCenteredFlex = styled('div', `
  display: flex;
  justify-content: center;
  align-items: center;
`);

const cssContributeButton = styled('div', `
  position: relative;
  background: ${theme.controlPrimaryBg};
  color: ${theme.controlPrimaryFg};
  border-radius: 25px;
  padding: 4px 12px 4px 8px;
  font-style: normal;
  font-weight: medium;
  font-size: 13px;
  line-height: 16px;
  cursor: pointer;
  --icon-color: ${theme.controlPrimaryFg};

  &:hover {
    background: ${theme.controlPrimaryHoverBg};
  }
`);

const cssButtonIconAndText = styled('div', `
  display: flex;
  gap: 8px;
`);

const cssContributeButtonCloseButton = styled(tokenFieldStyles.cssDeleteButton, `
  margin-left: 4px;
  vertical-align: bottom;
  line-height: 1;
  position: absolute;
  top: -4px;
  right: -8px;
  border-radius: 16px;
  background-color: ${colors.dark};
  width: 18px;
  height: 18px;
  cursor: pointer;
  z-index: 1;
  display: none;
  align-items: center;
  justify-content: center;

  .${cssContributeButton.className}:hover & {
    display: flex;
  }
`);

const cssCard = styled('div', `
  width: 297px;
  padding: 24px;
  color: ${theme.announcementPopupFg};
  background: ${theme.announcementPopupBg};
  border-radius: 4px;
  align-self: flex-start;
  position: sticky;
  flex-shrink: 0;
  top: 0px;
`);

const cssHeader = styled('div', `
  font-size: ${vars.xxxlargeFontSize};
  font-weight: 600;
  margin-bottom: 16px;
`);

const cssLeftAlignedHeader = styled(cssHeader, `
  text-align: left;
`);

const cssCenterAlignedHeader = styled(cssHeader, `
  text-align: center;
`);

const cssParagraph = styled('div', `
  font-size: 13px;
  line-height: 18px;
  margin-bottom: 12px;
`);

const cssPrimaryButton = styled(bigPrimaryButton, `
  display: flex;
  justify-content: center;
  align-items: center;
  margin-top: 32px;
  text-align: center;
`);

const cssFullWidthButton = styled(cssPrimaryButton, `
  width: 100%;
`);

const cssCloseButton = styled('div', `
  position: absolute;
  top: 8px;
  right: 8px;
  padding: 4px;
  border-radius: 4px;
  cursor: pointer;
  --icon-color: ${theme.popupCloseButtonFg};

  &:hover {
    background-color: ${theme.hover};
  }
`);

const cssSparks = styled('div', `
  height: 48px;
  width: 48px;
  background-image: var(--icon-Sparks);
  display: inline-block;
  background-repeat: no-repeat;
`);
