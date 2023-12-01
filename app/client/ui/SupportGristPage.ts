import {buildHomeBanners} from 'app/client/components/Banners';
import {makeT} from 'app/client/lib/localization';
import {AppModel} from 'app/client/models/AppModel';
import {urlState} from 'app/client/models/gristUrlState';
import {TelemetryModel, TelemetryModelImpl} from 'app/client/models/TelemetryModel';
import {AppHeader} from 'app/client/ui/AppHeader';
import {leftPanelBasic} from 'app/client/ui/LeftPanelCommon';
import {pagePanels} from 'app/client/ui/PagePanels';
import {createTopBarHome} from 'app/client/ui/TopBar';
import {cssBreadcrumbs, separator} from 'app/client/ui2018/breadcrumbs';
import {bigBasicButton, bigBasicButtonLink, bigPrimaryButton} from 'app/client/ui2018/buttons';
import {mediaSmall, theme, vars} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {cssLink} from 'app/client/ui2018/links';
import {loadingSpinner} from 'app/client/ui2018/loaders';
import {commonUrls, getPageTitleSuffix} from 'app/common/gristUrls';
import {TelemetryPrefsWithSources} from 'app/common/InstallAPI';
import {getGristConfig} from 'app/common/urlUtils';
import {Computed, Disposable, dom, makeTestId, Observable, styled, subscribe} from 'grainjs';

const testId = makeTestId('test-support-grist-page-');

const t = makeT('SupportGristPage');

export class SupportGristPage extends Disposable {
  private readonly _currentPage = Computed.create(this, urlState().state, (_use, s) => s.supportGrist);
  private readonly _model: TelemetryModel = new TelemetryModelImpl(this._appModel);
  private readonly _optInToTelemetry = Computed.create(this, this._model.prefs,
    (_use, prefs) => {
      if (!prefs) { return null; }

      return prefs.telemetryLevel.value !== 'off';
    })
    .onWrite(async (optIn) => {
      const telemetryLevel = optIn ? 'limited' : 'off';
      await this._model.updateTelemetryPrefs({telemetryLevel});
    });

  constructor(private _appModel: AppModel) {
    super();
    this._setPageTitle();
    this._model.fetchTelemetryPrefs().catch(reportError);
  }

  public buildDom() {
    const panelOpen = Observable.create(this, false);
    return pagePanels({
      leftPanel: {
        panelWidth: Observable.create(this, 240),
        panelOpen,
        hideOpener: true,
        header: dom.create(AppHeader, this._appModel),
        content: leftPanelBasic(this._appModel, panelOpen),
      },
      headerMain: this._buildMainHeader(),
      contentTop: buildHomeBanners(this._appModel),
      contentMain: this._buildMainContent(),
    });
  }

  private _buildMainHeader() {
    return dom.frag(
      cssBreadcrumbs({style: 'margin-left: 16px;'},
        cssLink(
          urlState().setLinkUrl({}),
          t('Home'),
        ),
        separator(' / '),
        dom('span', t('Support Grist')),
      ),
      createTopBarHome(this._appModel),
    );
  }

  private _buildMainContent() {
    return cssPageContainer(
      cssPage(
        dom('div',
          cssPageTitle(t('Support Grist')),
          this._buildTelemetrySection(),
          this._buildSponsorshipSection(),
        ),
      ),
    );
  }

  private _buildTelemetrySection() {
    return cssSection(
      cssSectionTitle(t('Telemetry')),
      dom.domComputed(this._model.prefs, prefs => {
        if (prefs === null) {
          return cssSpinnerBox(loadingSpinner());
        }

        const {activation} = getGristConfig();
        if (!activation?.isManager) {
          if (prefs.telemetryLevel.value === 'limited') {
            return [
              cssParagraph(t(
                'This instance is opted in to telemetry. Only the site administrator has permission to change this.',
              ))
            ];
          } else {
            return [
              cssParagraph(t(
                'This instance is opted out of telemetry. Only the site administrator has permission to change this.',
              ))
            ];
          }
        } else {
          return [
            cssParagraph(t(
              'Support Grist by opting in to telemetry, which helps us understand how the product ' +
              'is used, so that we can prioritize future improvements.'
            )),
            cssParagraph(
              t('We only collect usage statistics, as detailed in our {{link}}, never document contents.', {
                link: telemetryHelpCenterLink(),
              }),
            ),
            cssParagraph(t('You can opt out of telemetry at any time from this page.')),
            this._buildTelemetrySectionButtons(prefs),
          ];
        }
      }),
      testId('telemetry-section'),
    );
  }

  private _buildTelemetrySectionButtons(prefs: TelemetryPrefsWithSources) {
    const {telemetryLevel: {value, source}} = prefs;
    if (source === 'preferences') {
      return dom.domComputed(this._optInToTelemetry, (optedIn) => {
        if (optedIn) {
          return [
            cssOptInOutMessage(
              t('You have opted in to telemetry. Thank you!'), ' 🙏',
              testId('telemetry-section-message'),
            ),
            cssOptOutButton(t('Opt out of Telemetry'),
              dom.on('click', () => this._optInToTelemetry.set(false)),
            ),
          ];
        } else {
          return [
            cssOptInButton(t('Opt in to Telemetry'),
              dom.on('click', () => this._optInToTelemetry.set(true)),
            ),
          ];
        }
      });
    } else {
      return cssOptInOutMessage(
        value !== 'off'
          ? [t('You have opted in to telemetry. Thank you!'), ' 🙏']
          : t('You have opted out of telemetry.'),
        testId('telemetry-section-message'),
      );
    }
  }

  private _buildSponsorshipSection() {
    return cssSection(
      cssSectionTitle(t('Sponsor Grist Labs on GitHub')),
      cssParagraph(
        t(
          'Grist software is developed by Grist Labs, which offers free and paid ' +
          'hosted plans. We also make Grist code available under a standard free ' +
          'and open OSS license (Apache 2.0) on {{link}}.',
          {link: gristCoreLink()},
        ),
      ),
      cssParagraph(
        t(
          'You can support Grist open-source development by sponsoring ' +
          'us on our {{link}}.',
          {link: sponsorGristLink()},
        ),
      ),
      cssParagraph(t(
        'We are a small and determined team. Your support matters a lot to us. ' +
        'It also shows to others that there is a determined community behind this product.'
      )),
      cssSponsorButton(
        cssButtonIconAndText(icon('Heart'), cssButtonText(t('Manage Sponsorship'))),
        {href: commonUrls.githubSponsorGristLabs, target: '_blank'},
      ),
      testId('sponsorship-section'),
    );
  }

  private _setPageTitle() {
    this.autoDispose(subscribe(this._currentPage, (_use, page): string => {
      const suffix = getPageTitleSuffix(getGristConfig());
      switch (page) {
        case undefined:
        case 'support': {
          return document.title = `Support Grist${suffix}`;
        }
      }
    }));
  }
}

function telemetryHelpCenterLink() {
  return cssLink(
    t('Help Center'),
    {href: commonUrls.helpTelemetryLimited, target: '_blank'},
  );
}

function sponsorGristLink() {
  return cssLink(
    t('GitHub Sponsors page'),
    {href: commonUrls.githubSponsorGristLabs, target: '_blank'},
  );
}

function gristCoreLink() {
  return cssLink(
    t('GitHub'),
    {href: commonUrls.githubGristCore, target: '_blank'},
  );
}

const cssPageContainer = styled('div', `
  overflow: auto;
  padding: 64px 80px;

  @media ${mediaSmall} {
    & {
      padding: 0px;
    }
  }
`);

const cssPage = styled('div', `
  padding: 16px;
  max-width: 600px;
  width: 100%;
`);

const cssPageTitle = styled('div', `
  height: 32px;
  line-height: 32px;
  margin-bottom: 24px;
  color: ${theme.text};
  font-size: 24px;
  font-weight: ${vars.headerControlTextWeight};
`);

const cssSectionTitle = styled('div', `
  height: 24px;
  line-height: 24px;
  margin-bottom: 24px;
  color: ${theme.text};
  font-size: ${vars.xlargeFontSize};
  font-weight: ${vars.headerControlTextWeight};
`);

const cssSection = styled('div', `
  margin-bottom: 60px;
`);

const cssParagraph = styled('div', `
  color: ${theme.text};
  font-size: 14px;
  line-height: 20px;
  margin-bottom: 12px;
`);

const cssOptInOutMessage = styled(cssParagraph, `
  line-height: 40px;
  font-weight: 600;
  margin-top: 24px;
  margin-bottom: 0px;
`);

const cssOptInButton = styled(bigPrimaryButton, `
  margin-top: 24px;
`);

const cssOptOutButton = styled(bigBasicButton, `
  margin-top: 24px;
`);

const cssSponsorButton = styled(bigBasicButtonLink, `
  margin-top: 24px;
`);

const cssButtonIconAndText = styled('div', `
  display: flex;
  align-items: center;
`);

const cssButtonText = styled('span', `
  margin-left: 8px;
`);

const cssSpinnerBox = styled('div', `
  margin-top: 24px;
  text-align: center;
`);
