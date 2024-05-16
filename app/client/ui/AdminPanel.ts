import {buildHomeBanners} from 'app/client/components/Banners';
import {makeT} from 'app/client/lib/localization';
import {localStorageJsonObs} from 'app/client/lib/localStorageObs';
import {getTimeFromNow} from 'app/client/lib/timeUtils';
import {AppModel, getHomeUrl, reportError} from 'app/client/models/AppModel';
import {AdminChecks} from 'app/client/models/AdminChecks';
import {urlState} from 'app/client/models/gristUrlState';
import {AppHeader} from 'app/client/ui/AppHeader';
import {leftPanelBasic} from 'app/client/ui/LeftPanelCommon';
import {pagePanels} from 'app/client/ui/PagePanels';
import {SupportGristPage} from 'app/client/ui/SupportGristPage';
import {createTopBarHome} from 'app/client/ui/TopBar';
import {cssBreadcrumbs, separator} from 'app/client/ui2018/breadcrumbs';
import {basicButton} from 'app/client/ui2018/buttons';
import {toggle} from 'app/client/ui2018/checkbox';
import {mediaSmall, testId, theme, vars} from 'app/client/ui2018/cssVars';
import {cssLink, makeLinks} from 'app/client/ui2018/links';
import {SandboxingBootProbeDetails} from 'app/common/BootProbe';
import {commonUrls, getPageTitleSuffix} from 'app/common/gristUrls';
import {InstallAPI, InstallAPIImpl, LatestVersion} from 'app/common/InstallAPI';
import {naturalCompare} from 'app/common/SortFunc';
import {getGristConfig} from 'app/common/urlUtils';
import * as version from 'app/common/version';
import {Computed, Disposable, dom, IDisposable,
        IDisposableOwner, MultiHolder, Observable, styled} from 'grainjs';
import {AdminSection, AdminSectionItem, HidableToggle} from 'app/client/ui/AdminPanelCss';


const t = makeT('AdminPanel');

// Translated "Admin Panel" name, made available to other modules.
export function getAdminPanelName() {
  return t("Admin Panel");
}

export class AdminPanel extends Disposable {
  private _supportGrist = SupportGristPage.create(this, this._appModel);
  private readonly _installAPI: InstallAPI = new InstallAPIImpl(getHomeUrl());
  private _checks: AdminChecks;

  constructor(private _appModel: AppModel) {
    super();
    document.title = getAdminPanelName() + getPageTitleSuffix(getGristConfig());
    this._checks = new AdminChecks(this);
  }

  public buildDom() {
    this._checks.fetchAvailableChecks().catch(err => {
      reportError(err);
    });
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
      contentMain: dom.create(this._buildMainContent.bind(this)),
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
        dom('span', getAdminPanelName()),
      ),
      createTopBarHome(this._appModel),
    );
  }

  private _buildMainContent(owner: MultiHolder) {
    return cssPageContainer(
      dom.cls('clipboard'),
      {tabIndex: "-1"},
      dom.create(AdminSection, t('Support Grist'), [
        dom.create(AdminSectionItem, {
          id: 'telemetry',
          name: t('Telemetry'),
          description: t('Help us make Grist better'),
          value: dom.create(HidableToggle, this._supportGrist.getTelemetryOptInObservable()),
          expandedContent: this._supportGrist.buildTelemetrySection(),
        }),
        dom.create(AdminSectionItem, {
          id: 'sponsor',
          name: t('Sponsor'),
          description: t('Support Grist Labs on GitHub'),
          value: this._supportGrist.buildSponsorshipSmallButton(),
          expandedContent: this._supportGrist.buildSponsorshipSection(),
        }),
      ]),
      dom.create(AdminSection, t('Security Settings'), [
        dom.create(AdminSectionItem, {
          id: 'sandboxing',
          name: t('Sandboxing'),
          description: t('Sandbox settings for data engine'),
          value: this._buildSandboxingDisplay(owner),
          expandedContent: this._buildSandboxingNotice(),
        }),
      ]),

      dom.create(AdminSection, t('Version'), [
        dom.create(AdminSectionItem, {
          id: 'version',
          name: t('Current'),
          description: t('Current version of Grist'),
          value: cssValueLabel(`Version ${version.version}`),
        }),
        this._buildUpdates(owner),
      ]),
      testId('admin-panel'),
    );
  }

  private _buildSandboxingDisplay(owner: IDisposableOwner) {
    return dom.domComputed(
      use => {
        const req = this._checks.requestCheckById(use, 'sandboxing');
        const result = req ? use(req.result) : undefined;
        const success = result?.success;
        const details = result?.details as SandboxingBootProbeDetails|undefined;
        if (!details) {
          return cssValueLabel(t('unknown'));
        }
        const flavor = details.flavor;
        const configured = details.configured;
        return cssValueLabel(
          configured ?
              (success ? cssHappyText(t('OK') + `: ${flavor}`) :
                  cssErrorText(t('Error') + `: ${flavor}`)) :
              cssErrorText(t('unconfigured')));
      }
    );
  }

  private _buildSandboxingNotice() {
    return [
      t('Grist allows for very powerful formulas, using Python. \
We recommend setting the environment variable GRIST_SANDBOX_FLAVOR to gvisor \
if your hardware supports it (most will), \
to run formulas in each document within a sandbox \
isolated from other documents and isolated from the network.'),
      dom(
        'div',
        {style: 'margin-top: 8px'},
        cssLink({href: commonUrls.helpSandboxing, target: '_blank'}, t('Learn more.'))
      ),
    ];
  }

  private _buildUpdates(owner: MultiHolder) {
    // We can be in those states:
    enum State {
      // Never checked before (no last version or last check time).
      // Shows "No information available" [Check now]
      NEVER,
      // Did check previously, but it was a while ago, user should press the button to check.
      // Shows "Last checked X days ago" [Check now]
      STALE,
      // In the middle of checking for updates.
      CHECKING,
      // Transient state, shown after Check now is clicked.
      // Grist is up to date (state only shown after a successful check), or even upfront.
      // Won't be shown after page is reloaded.
      // Shows "Checking for updates..."
      CURRENT,
      // A newer version is available. Can be shown after reload if last
      // version that was checked is newer than the current version.
      // Shows "Newer version available" [version]
      AVAILABLE,
      // Error occurred during this check. If the error occurred during last check
      // it is not stored.
      // Shows "Error checking for updates" [Check now]
      ERROR,
    }

    // Are updates enabled at all.
    const defaultValue = {
      onLoad: false,
      lastCheckDate: null as number|null,
      lastVersion: null as string|null,
    };
    const prop = <T extends keyof typeof defaultValue>(key: T) => {
      const computed = Computed.create(owner, (use) => use(settings)[key]);
      computed.onWrite((val) => settings.set({...settings.get(), [key]: val}));
      return computed as Observable<typeof defaultValue[T]>;
    };
    const settings = owner.autoDispose(localStorageJsonObs('new-version-check', defaultValue));
    const onLoad = prop('onLoad');
    const latestVersion = prop('lastVersion');
    const lastCheckDate = prop('lastCheckDate');
    const comparison = Computed.create(owner, (use) => {
      const versions = [version.version, use(latestVersion)];
      if (!versions[1]) {
        return null;
      }
      // Sort them in natural order, so that "1.10" comes after "1.9".
      versions.sort(naturalCompare).reverse();
      if (versions[0] === version.version) {
        return 'old';
      } else {
        return 'new';
      }
    });

    // Observable state of the updates check.
    const state: Observable<State> = Observable.create(owner, State.NEVER);

    // The background task that checks for updates, can be disposed (cancelled) when needed.
    let backgroundTask: IDisposable|null = null;

    // By default we link to the GitHub releases page, but the endpoint might say something different.
    let releaseURL = 'https://github.com/gristlabs/grist-core/releases';

    // All the events that might occur
    const actions = {
      checkForUpdates: async () => {
        state.set(State.CHECKING);
        latestVersion.set(null);
        // We can be disabled, why the check is in progress.
        const controller = new AbortController();
        backgroundTask = {
          dispose() {
            if (controller.signal.aborted) { return; }
            backgroundTask = null;
            controller.abort();
          }
        };
        owner.autoDispose(backgroundTask);
        try {
          const result = await this._installAPI.checkUpdates();
          if (controller.signal.aborted) { return; }
          actions.gotLatestVersion(result);
        } catch(err) {
          if (controller.signal.aborted) { return; }
          state.set(State.ERROR);
          reportError(err);
        }
      },
      disableAutoCheck: () => {
        backgroundTask?.dispose();
        backgroundTask = null;
        onLoad.set(false);
      },
      enableAutoCheck: () => {
        onLoad.set(true);
        if (state.get() !== State.CHECKING && state.get() !== State.AVAILABLE) {
          actions.checkForUpdates().catch(reportError);
        }
      },
      gotLatestVersion: (data: LatestVersion) => {
        lastCheckDate.set(Date.now());
        latestVersion.set(data.latestVersion);
        releaseURL = data.updateURL || releaseURL;
        const result = comparison.get();
        switch (result) {
          case 'old': state.set(State.CURRENT); break;
          case 'new': state.set(State.AVAILABLE); break;
          // This should not happen, but if it does, we should show the error.
          default: state.set(State.ERROR); break;
        }
      }
    };

    const description = Computed.create(owner, (use) => {
      switch (use(state)) {
        case State.NEVER: return t('No information available');
        case State.CHECKING: return '⌛ ' + t('Checking for updates...');
        case State.CURRENT: return '✅ ' + t('Grist is up to date');
        case State.AVAILABLE: return t('Newer version available');
        case State.ERROR: return '❌ ' + t('Error checking for updates');
        case State.STALE: {
          const lastCheck = use(lastCheckDate);
          return t('Last checked {{time}}', {time: lastCheck ? getTimeFromNow(lastCheck) : 'n/a'});
        }
      }
    });

    // Now trigger the initial state, by checking if we should auto-check.
    if (onLoad.get()) {
      actions.checkForUpdates().catch(reportError);
    } else {
      if (comparison.get() === 'new') {
        state.set(State.AVAILABLE);
      } else if (comparison.get() === 'old') {
        state.set(State.STALE);
      } else {
        state.set(State.NEVER); // default one.
      }
    }

    // Toggle component operates on a boolean observable, without a way to set the value. So
    // create a controller for it to intercept the write and call the appropriate action.
    const enabledController = Computed.create(owner, (use) => use(onLoad));
    enabledController.onWrite((val) => {
      if (val) {
        actions.enableAutoCheck();
      } else {
        actions.disableAutoCheck();
      }
    });

    const upperCheckNowVisible = Computed.create(owner, (use) => {
      switch (use(state)) {
        case State.CHECKING:
        case State.CURRENT:
        case State.AVAILABLE:
          return false;
        default:
          return true;
      }
    });

    return dom.create(AdminSectionItem, {
      id: 'updates',
      name: t('Updates'),
      description: dom('span', testId('admin-panel-updates-message'), dom.text(description)),
      value: cssValueButton(
        dom.domComputed(use => {
          if (use(state) === State.CHECKING) {
            return null;
          }

          if (use(upperCheckNowVisible)) {
            return basicButton(
              t('Check now'),
              dom.on('click', actions.checkForUpdates),
              testId('admin-panel-updates-upper-check-now')
            );
          }

          if (use(latestVersion)) {
            return cssValueLabel(`Version ${use(latestVersion)}`, testId('admin-panel-updates-version'));
          }

          throw new Error('Invalid state');
        })
      ),
      expandedContent: cssColumns(
        cssColumn(
          cssColumn.cls('-left'),
          dom('div', t('Grist releases are at '), makeLinks(releaseURL)),
          dom.maybe(lastCheckDate, ms => dom('div',
            dom('span', t('Last checked {{time}}', {time: getTimeFromNow(ms)})),
            dom('span', ' '),
            // Format date in local format.
            cssGrayed(new Date(ms).toLocaleString()),
          )),
          dom('div', t('Auto-check when this page loads')),
        ),
        cssColumn(
          cssColumn.cls('-right'),
          // `Check now` button, only shown when auto checks are enabled and we are not in the
          // middle of checking. Otherwise the button is shown in the summary row, and there is
          // no need to duplicate it.
          dom.maybe(use => !use(upperCheckNowVisible), () => [
            cssCheckNowButton(
              t('Check now'),
              testId('admin-panel-updates-lower-check-now'),
              dom.on('click', actions.checkForUpdates),
              dom.prop('disabled', use => use(state) === State.CHECKING),
            ),
          ]),
          toggle(enabledController, testId('admin-panel-updates-auto-check')),
        ),
      )
    });
  }
}

const cssPageContainer = styled('div', `
  overflow: auto;
  padding: 40px;
  font-size: ${vars.introFontSize};
  color: ${theme.text};

  @media ${mediaSmall} {
    & {
      padding: 0px;
      font-size: ${vars.mediumFontSize};
    }
  }
`);


export const cssValueLabel = styled('div', `
  padding: 4px 8px;
  color: ${theme.text};
  border: 1px solid ${theme.inputBorder};
  border-radius: ${vars.controlBorderRadius};
`);

// A wrapper for the version details panel. Shows two columns.
// First grows as needed, second shrinks as needed and is aligned to the bottom.
const cssColumns = styled('div', `
  display: flex;
  align-items: flex-end;
  & > div:first-child {
    flex-grow: 1;
    flex-shrink: 0;
  }
  & > div:last-child {
    flex-shrink: 1;
  }
`);

const cssColumn = styled('div', `
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex-grow: 1;
  flex-shrink: 1;
  margin-block: 1px; /* otherwise toggle is squashed: TODO: -1px in toggle looks like a bug */
  &-left {
    align-items: flex-start;
  }
  &-right {
    align-items: flex-end;
    justify-content: flex-end;
  }
`);

const cssValueButton = styled('div', `
  height: 30px;
`);

const cssCheckNowButton = styled(basicButton, `
  &-hidden {
    visibility: hidden;
  }
`);

const cssGrayed = styled('span', `
  color: ${theme.lightText};
`);

const cssErrorText = styled('span', `
  color: ${theme.errorText};
`);

const cssHappyText = styled('span', `
  color: ${theme.controlFg};
`);
