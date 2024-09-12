import {makeT} from 'app/client/lib/localization';
import {tokenFieldStyles} from 'app/client/lib/TokenField';
import {AppModel} from 'app/client/models/AppModel';
import {urlState} from 'app/client/models/gristUrlState';
import {TelemetryModel, TelemetryModelImpl} from 'app/client/models/TelemetryModel';
import {basicButton, basicButtonLink, bigPrimaryButton} from 'app/client/ui2018/buttons';
import {colors, testId, theme, vars} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {cssLink} from 'app/client/ui2018/links';
import {modal} from 'app/client/ui2018/modals';
import {commonUrls, isFeatureEnabled} from 'app/common/gristUrls';
import {getGristConfig} from 'app/common/urlUtils';
import {Computed, Disposable, dom, DomContents, Observable, styled} from 'grainjs';

const t = makeT('SupportGristNudge');

/**
 * Button that nudges users to support Grist by opting in to telemetry or sponsoring on Github.
 *
 * For installation admins, this includes a modal with a nudge which collapses into a "Support
 * Grist" button in the top bar. When that's not applicable, it is only a "Support Grist" button
 * that links to the Github sponsorship page.
 *
 * Users can dismiss this button.
 */
export class SupportGristButton extends Disposable {
  private readonly _showButton: Computed<null|'link'|'expand'>;
  private readonly _telemetryModel: TelemetryModel = TelemetryModelImpl.create(this, this._appModel);

  constructor(private _appModel: AppModel) {
    super();
    const {deploymentType, telemetry} = getGristConfig();
    const isEnabled = (deploymentType === 'core') && isFeatureEnabled("supportGrist");
    const isAdmin = _appModel.isInstallAdmin();
    const isTelemetryOn = (telemetry && telemetry.telemetryLevel !== 'off');
    const isAdminNudgeApplicable = isAdmin && !isTelemetryOn;

    this._showButton = Computed.create(this, use => {
      if (!isEnabled || use(_appModel.dismissedPopups).includes('supportGrist')) {
        return null;
      }

      return isAdminNudgeApplicable ? 'expand' : 'link';
    });
  }

  public buildDom(): DomContents {
    return dom.domComputed(this._showButton, (which) => {
      if (!which) { return null; }
      const elemType = (which === 'link') ? basicButtonLink : basicButton;
      return cssContributeButton(
        elemType(cssHeartIcon('💛 '), t('Support Grist'),
          (which === 'link' ?
            {href: commonUrls.githubSponsorGristLabs, target: '_blank'} :
            dom.on('click', () => this._buildNudgeModal())
          ),

          cssContributeButtonCloseButton(
            icon('CrossSmall'),
            dom.on('click', (ev) => {
              ev.stopPropagation();
              ev.preventDefault();
              this._markDismissed();
            }),
            testId('support-grist-button-dismiss'),
          ),
          testId('support-grist-button'),
        )
      );
    });
  }

  private _buildNudgeModal() {
    return modal((ctl, owner) => {
      const currentStep = Observable.create<'opt-in' | 'opted-in'>(owner, 'opt-in');

      return [
        cssModal.cls(''),
        cssCloseButton(
          icon('CrossBig'),
          dom.on('click', () => ctl.close()),
          testId('support-nudge-close'),
        ),
        dom.domComputed(currentStep, (step) => {
          return step === 'opt-in'
            ? this._buildOptInScreen(async () => {
              await this._optInToTelemetry();
              currentStep.set('opted-in');
            })
            : this._buildOptedInScreen(() => ctl.close());
        }),
      ];
    }, {});
  }

  private _buildOptInScreen(onOptIn: () => Promise<void>) {
    return [
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
            supportGristLink: adminPanelLink(),
          },
        ),
      ),
      cssFullWidthButton(
        t('Opt in to Telemetry'),
        dom.on('click', () => onOptIn()),
        testId('support-nudge-opt-in'),
      ),
    ];
  }

  private _buildOptedInScreen(onClose: () => void) {
    return [
      cssCenteredFlex(cssSparks()),
      cssCenterAlignedHeader(t('Opted In')),
      cssParagraph(
        t(
          'Thank you! Your trust and support is greatly appreciated.\
 Opt out any time from the {{link}} in the user menu.',
          {link: adminPanelLink()},
        ),
      ),
      cssCenteredFlex(
        cssPrimaryButton(
          t('Close'),
          dom.on('click', () => onClose()),
          testId('support-nudge-close-button'),
        ),
      ),
    ];
  }

  private _markDismissed() {
    this._appModel.dismissPopup('supportGrist', true);
  }

  private async _optInToTelemetry() {
    await this._telemetryModel.updateTelemetryPrefs({telemetryLevel: 'limited'});
    this._markDismissed();
  }
}

function helpCenterLink() {
  return cssLink(
    t('Help Center'),
    {href: commonUrls.helpTelemetryLimited, target: '_blank'},
  );
}

function adminPanelLink() {
  return cssLink(
    t('Admin Panel'),
    {href: urlState().makeUrl({adminPanel: 'admin'}), target: '_blank'},
  );
}

const cssCenteredFlex = styled('div', `
  display: flex;
  justify-content: center;
  align-items: center;
`);

const cssContributeButton = styled('div', ``);

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
  --icon-color: ${colors.light};

  .${cssContributeButton.className}:hover & {
    display: flex;
  }
  &:hover {
    --icon-color: ${colors.lightGreen};
  }
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

// This is just to avoid the emoji pushing the button to be taller.
const cssHeartIcon = styled('span', `
  line-height: 1;
`);

const cssModal = styled('div', `
  position: relative;
  width: 100%;
  max-width: 400px;
  min-width: 0px;
`);
