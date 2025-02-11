import {buildHomeBanners} from 'app/client/components/Banners';
import {makeT} from 'app/client/lib/localization';
import {localStorageJsonObs} from 'app/client/lib/localStorageObs';
import {getTimeFromNow} from 'app/client/lib/timeUtils';
import {AdminChecks, probeDetails, ProbeDetails} from 'app/client/models/AdminChecks';
import {AppModel, getHomeUrl, reportError} from 'app/client/models/AppModel';
import {AuditLogsModel} from 'app/client/models/AuditLogsModel';
import {urlState} from 'app/client/models/gristUrlState';
import {AppHeader} from 'app/client/ui/AppHeader';
import {AuditLogStreamingConfig, getDestinationDisplayName} from 'app/client/ui/AuditLogStreamingConfig';
import {InstallConfigsAPI} from 'app/client/ui/ConfigsAPI';
import {leftPanelBasic} from 'app/client/ui/LeftPanelCommon';
import {pagePanels} from 'app/client/ui/PagePanels';
import {SupportGristPage} from 'app/client/ui/SupportGristPage';
import {ToggleEnterpriseWidget} from 'app/client/ui/ToggleEnterpriseWidget';
import {createTopBarHome} from 'app/client/ui/TopBar';
import {cssBreadcrumbs, separator} from 'app/client/ui2018/breadcrumbs';
import {basicButton} from 'app/client/ui2018/buttons';
import {toggle} from 'app/client/ui2018/checkbox';
import {mediaSmall, testId, theme, vars} from 'app/client/ui2018/cssVars';
import {cssLink, makeLinks} from 'app/client/ui2018/links';
import {BootProbeInfo, BootProbeResult, SandboxingBootProbeDetails} from 'app/common/BootProbe';
import {commonUrls, getPageTitleSuffix} from 'app/common/gristUrls';
import {InstallAPI, InstallAPIImpl, LatestVersion} from 'app/common/InstallAPI';
import {naturalCompare} from 'app/common/SortFunc';
import {getGristConfig} from 'app/common/urlUtils';
import * as version from 'app/common/version';
import {Computed, Disposable, dom, IDisposable,
        IDisposableOwner, MultiHolder, Observable, styled} from 'grainjs';
import {AdminSection, AdminSectionItem, HidableToggle} from 'app/client/ui/AdminPanelCss';
import {getAdminPanelName} from 'app/client/ui/AdminPanelName';

const t = makeT('AdminPanel');

export class AdminPanel extends Disposable {
  private _supportGrist = SupportGristPage.create(this, this._appModel);
  private _toggleEnterprise = ToggleEnterpriseWidget.create(this, this._appModel.notifier);
  private readonly _installAPI: InstallAPI = new InstallAPIImpl(getHomeUrl());
  private _checks: AdminChecks;

  constructor(private _appModel: AppModel) {
    super();
    document.title = getAdminPanelName() + getPageTitleSuffix(getGristConfig());
    this._checks = new AdminChecks(this, this._installAPI);
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
    // If probes are available, show the panel as normal.
    // Otherwise say it is unavailable, and describe a fallback
    // mechanism for access.
    return cssPageContainer(
      dom.cls('clipboard'),
      {tabIndex: "-1"},
      dom.maybe(this._checks.probes, probes => {
        return probes.length > 0
            ? this._buildMainContentForAdmin(owner)
            : this._buildMainContentForOthers(owner);
      }),
      testId('admin-panel'),
    );
  }

  /**
   * Show something helpful to those without access to the panel,
   * which could include a legit adminstrator if auth is misconfigured.
   */
  private _buildMainContentForOthers(owner: MultiHolder) {
    const exampleKey = _longCodeForExample();
    return dom.create(AdminSection, t('Administrator Panel Unavailable'), [
      dom('p', t(`You do not have access to the administrator panel.
Please log in as an administrator.`)),
      dom(
        'p',
        t(`Or, as a fallback, you can set: {{bootKey}} in the environment and visit: {{url}}`, {
          bootKey: dom('pre', `GRIST_BOOT_KEY=${exampleKey}`),
          url: dom('pre', `/admin?boot-key=${exampleKey}`)
        }),
      ),
      testId('admin-panel-error'),
    ]);
  }

  private _buildMainContentForAdmin(owner: MultiHolder) {
    return [
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
        dom.create(AdminSectionItem, {
          id: 'authentication',
          name: t('Authentication'),
          description: t('Current authentication method'),
          value: this._buildAuthenticationDisplay(owner),
          expandedContent: this._buildAuthenticationNotice(owner),
        }),
        dom.create(AdminSectionItem, {
          id: 'session',
          name: t('Session Secret'),
          description: t('Key to sign sessions with'),
          value: this._buildSessionSecretDisplay(owner),
          expandedContent: this._buildSessionSecretNotice(owner),
        })
      ]),
      this._buildAuditLogsSection(),
      dom.create(AdminSection, t('Version'), [
        dom.create(AdminSectionItem, {
          id: 'version',
          name: t('Current'),
          description: t('Current version of Grist'),
          value: cssValueLabel(`Version ${version.version}`),
        }),
        this._maybeAddEnterpriseToggle(),
        this._buildUpdates(owner),
      ]),
      dom.create(AdminSection, t('Self Checks'), [
        this._buildProbeItems(owner, {
          showRedundant: false,
          showNovel: true,
        }),
        dom.create(AdminSectionItem, {
          id: 'probe-other',
          name: 'more...',
          description: '',
          value: '',
          expandedContent: this._buildProbeItems(owner, {
            showRedundant: true,
            showNovel: false,
          }),
        }),
      ]),
    ];
  }

  private _maybeAddEnterpriseToggle() {
    let makeToggle = () => dom.create(HidableToggle, this._toggleEnterprise.getEnterpriseToggleObservable());

    // If the enterprise edition is forced, we don't show the toggle.
    if (getGristConfig().forceEnableEnterprise) {
      makeToggle = () => cssValueLabel(cssHappyText(t("On")));
    }

    return dom.create(AdminSectionItem, {
      id: 'enterprise',
      name: t('Enterprise'),
      description: t('Enable Grist Enterprise'),
      value: makeToggle(),
      expandedContent: this._toggleEnterprise.buildEnterpriseSection(),
    });
  }

  private _buildSandboxingDisplay(owner: IDisposableOwner) {
    return dom.domComputed(
      use => {
        const req = this._checks.requestCheckById(use, 'sandboxing');
        const result = req ? use(req.result) : undefined;
        const success = result?.status === 'success';
        const details = result?.details as SandboxingBootProbeDetails|undefined;
        if (!details) {
          // Sandbox details get filled out relatively slowly if
          // this is first time on admin panel. So show "checking"
          // if we don't have a reported status yet.
          return cssValueLabel(result?.status ? t('unknown') : t('checking'));
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
      // Use AdminChecks text for sandboxing, in order not to
      // duplicate.
      probeDetails['sandboxing'].info,
      dom(
        'div',
        {style: 'margin-top: 8px'},
        cssLink({href: commonUrls.helpSandboxing, target: '_blank'}, t('Learn more.'))
      ),
    ];
  }

  private _buildAuthenticationDisplay(owner: IDisposableOwner) {
    return dom.domComputed(
      use => {
        const req = this._checks.requestCheckById(use, 'authentication');
        const result = req ? use(req.result) : undefined;
        if (!result) {
          return cssValueLabel(cssErrorText('unavailable'));
        }

        const { status, details } = result;
        const success = status === 'success';
        const loginSystemId = details?.loginSystemId;

        if (!success || !loginSystemId) {
          return cssValueLabel(cssErrorText('auth error'));
        }

        if (loginSystemId === 'no-logins') {
          return cssValueLabel(cssDangerText('no authentication'));
        }

        return cssValueLabel(cssHappyText(loginSystemId));
      }
    );
  }

  private _buildAuthenticationNotice(owner: IDisposableOwner) {
    return t('Grist allows different types of authentication to be configured, including SAML and OIDC. \
We recommend enabling one of these if Grist is accessible over the network or being made available \
to multiple people.');
  }

  private _buildSessionSecretDisplay(owner: IDisposableOwner) {
    return dom.domComputed(
      use => {
        const req = this._checks.requestCheckById(use, 'session-secret');
        const result = req ? use(req.result) : undefined;

        if (result?.status === 'warning') {
          return cssValueLabel(cssDangerText('default'));
        }

        return cssValueLabel(cssHappyText('configured'));
      }
    );
  }

  private _buildSessionSecretNotice(owner: IDisposableOwner) {
    return t('Grist signs user session cookies with a secret key. Please set this key via the environment variable \
GRIST_SESSION_SECRET. Grist falls back to a hard-coded default when it is not set. We may remove this notice \
in the future as session IDs generated since v1.1.16 are inherently cryptographically secure.');
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

  /**
   * Show the results of various checks. Of the checks, some are considered
   * "redundant" (already covered elsewhere in the Admin Panel) and the
   * remainder are "novel".
   */
  private _buildProbeItems(owner: MultiHolder, options: {
    showRedundant: boolean,
    showNovel: boolean,
  }) {
    return dom.domComputed(
      use => [
        ...use(this._checks.probes).map(probe => {
          const isRedundant = [
            'sandboxing',
            'authentication',
            'session-secret'
          ].includes(probe.id);
          const show = isRedundant ? options.showRedundant : options.showNovel;
          if (!show) { return null; }
          const req = this._checks.requestCheck(probe);
          return this._buildProbeItem(owner, req.probe, use(req.result), req.details);
        }),
      ]
    );
  }

  /**
   * Show the result of an individual check.
   */
  private _buildProbeItem(owner: MultiHolder,
                          info: BootProbeInfo,
                          result: BootProbeResult,
                          details: ProbeDetails|undefined) {

    const status = this._encodeSuccess(result);
    return dom.create(AdminSectionItem, {
      id: `probe-${info.id}`,
      name: info.id,
      description: info.name,
      value: cssStatus(status),
      expandedContent: [
        cssCheckHeader(
          t('Results'),
          { style: 'margin-top: 0px; padding-top: 0px;' },
        ),
        result.verdict ? dom('pre', result.verdict) : null,
        (result.status === 'none') ? null :
            dom('p',
                (result.status === 'success') ? t('Check succeeded.') : t('Check failed.')),
        (result.status !== 'none') ? null :
            dom('p', t('No fault detected.')),
        (details?.info === undefined) ? null : [
          cssCheckHeader(t('Notes')),
          details.info,
        ],
        (result.details === undefined) ? null : [
          cssCheckHeader(t('Details')),
          ...Object.entries(result.details).map(([key, val]) => {
            return dom(
              'div',
              cssLabel(key),
              dom('input', dom.prop(
                'value',
                typeof val === 'string' ? val : JSON.stringify(val))));
          }),
        ],
      ],
    });
  }

  /**
   * Give an icon summarizing success or failure. Factor in the
   * severity of the result for failures. This is crude, the
   * visualization of the results can be elaborated in future.
   */
  private _encodeSuccess(result: BootProbeResult) {
    switch (result.status) {
      case 'success':
        return '✅';
      case 'fault':
        return '❌';
      case 'warning':
        return '❗';
      case 'hmm':
        return '?';
      case 'none':
        return '―';
      default:
        // should not arrive here
        return '??';
    }
  }

  private _buildAuditLogsSection() {
    const { deploymentType } = getGristConfig();
    switch (deploymentType) {
      // Note: SaaS builds are only included to streamline UI testing.
      case "core":
      case "enterprise":
      case "saas": {
        return dom.create(
          AdminSection,
          [t("Audit Logs"), cssSectionTag(t("New, Enterprise"))],
          [this._buildLogStreamingSection(deploymentType)]
        );
      }
      default: {
        return null;
      }
    }
  }

  private _buildLogStreamingSection(
    deploymentType: "core" | "enterprise" | "saas"
  ) {
    if (deploymentType === "core") {
      return dom.create(AdminSectionItem, {
        id: "log-streaming",
        name: t("Log Streaming"),
        expandedContent: t(
          "You can set up streaming of audit events from Grist to an " +
            "external security information and event management (SIEM) " +
            "system if you enable Grist Enterprise. {{contactUsLink}} to " +
            "learn more.",
          {
            contactUsLink: cssLink(
              { href: commonUrls.contact, target: "_blank" },
              t("Contact us")
            ),
          }
        ),
      });
    } else {
      const model = new AuditLogsModel({
        configsAPI: new InstallConfigsAPI(),
      });
      model.fetchStreamingDestinations().catch(reportError);

      return dom.create(AdminSectionItem, {
        id: "log-streaming",
        name: t("Log Streaming"),
        value: this._buildLogStreamingStatus(model),
        expandedContent: dom.create(AuditLogStreamingConfig, model),
      });
    }
  }

  private _buildLogStreamingStatus(model: AuditLogsModel) {
    return dom.domComputed((use) => {
      const destinations = use(model.streamingDestinations);
      if (!destinations) {
        return null;
      } else if (destinations.length === 0) {
        return cssValueLabel(cssDangerText(t("Off")));
      } else {
        const [first, ...rest] = destinations;
        let status: string;
        if (rest.length > 0) {
          status = t(
            "{{firstDestinationName}} + {{- remainingDestinationsCount}} more",
            {
              firstDestinationName: getDestinationDisplayName(first.name),
              remainingDestinationsCount: rest.length,
            }
          );
        } else {
          status = getDestinationDisplayName(first.name);
        }
        return cssValueLabel(cssHappyText(status));
      }
    });
  }
}

// Ugh I'm not a front end person. h5 small-caps, sure why not.
// Hopefully someone with taste will edit someday!
const cssCheckHeader = styled('h5', `
  margin-bottom: 5px;
  font-variant: small-caps;
`);

const cssStatus = styled('div', `
  display: inline-block;
  text-align: center;
  width: 40px;
  padding: 5px;
`);

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

export const cssDangerText = styled('div', `
  color: ${theme.dangerText};
`);

const cssHappyText = styled('span', `
  color: ${theme.controlFg};
`);

export const cssLabel = styled('div', `
  display: inline-block;
  min-width: 100px;
  text-align: right;
  padding-right: 5px;
`);

const cssSectionTag = styled('span', `
  color: ${theme.accentText};
  text-transform: uppercase;
  font-size: 8px;
  vertical-align: super;
  margin-top: -4px;
  margin-left: 4px;
  font-weight: bold;
`);

/**
 * Make a long code to use in the example, so that if people copy
 * and paste it lazily, they end up decently secure, or at least a
 * lot more secure than a key like "REPLACE_WITH_YOUR_SECRET"
 */
function _longCodeForExample() {
  // Crypto in insecure contexts doesn't have randomUUID
  if (window.isSecureContext) {
    return 'example-a' + window.crypto.randomUUID();
  }
  return 'example-b' + 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'.replace(/x/g, () => {
    return Math.floor(Math.random() * 16).toString(16);
  });
}
