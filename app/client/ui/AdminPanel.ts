import {buildHomeBanners} from 'app/client/components/Banners';
import {makeT} from 'app/client/lib/localization';
import {markdown} from 'app/client/lib/markdown';
import {getTimeFromNow} from 'app/client/lib/timeUtils';
import {AdminChecks, probeDetails, ProbeDetails} from 'app/client/models/AdminChecks';
import {AppModel, getHomeUrl, reportError} from 'app/client/models/AppModel';
import {App} from 'app/client/ui/App';
import {cssEmail, cssUserInfo, cssUserName} from 'app/client/ui/AccountWidgetCss';
import {createUserImage} from 'app/client/ui/UserImage';
import {AuditLogsModel} from 'app/client/models/AuditLogsModel';
import {urlState} from 'app/client/models/gristUrlState';
import {showEnterpriseToggle} from 'app/client/ui/ActivationPage';
import {buildAdminData} from 'app/client/ui/AdminControls';
import {buildAdminLeftPanel, getPageNames} from 'app/client/ui/AdminLeftPanel';
import {AdminSection, AdminSectionItem, cssValueLabel, HidableToggle} from 'app/client/ui/AdminPanelCss';
import {getAdminPanelName} from 'app/client/ui/AdminPanelName';
import {AuditLogStreamingConfig, getDestinationDisplayName} from 'app/client/ui/AuditLogStreamingConfig';
import {InstallConfigsAPI} from 'app/client/ui/ConfigsAPI';
import {pagePanels} from 'app/client/ui/PagePanels';
import {SupportGristPage} from 'app/client/ui/SupportGristPage';
import {ToggleEnterpriseWidget} from 'app/client/ui/ToggleEnterpriseWidget';
import {createTopBarHome} from 'app/client/ui/TopBar';
import {cssBreadcrumbs, separator} from 'app/client/ui2018/breadcrumbs';
import {basicButton} from 'app/client/ui2018/buttons';
import {mediaSmall, testId, theme, vars} from 'app/client/ui2018/cssVars';
import {cssLink, makeLinks} from 'app/client/ui2018/links';
import {toggleSwitch} from 'app/client/ui2018/toggleSwitch';
import {BootProbeInfo, BootProbeResult, SandboxingBootProbeDetails} from 'app/common/BootProbe';
import {AdminPanelPage, commonUrls, getPageTitleSuffix, LatestVersionAvailable} from 'app/common/gristUrls';
import {InstallAPI, InstallAPIImpl} from 'app/common/InstallAPI';
import {InstallAdminInfo} from 'app/common/LoginSessionAPI';
import {getGristConfig} from 'app/common/urlUtils';
import * as version from 'app/common/version';
import {Computed, Disposable, dom, IDisposable, MultiHolder, Observable, styled, UseCBOwner} from 'grainjs';

const t = makeT('AdminPanel');

// A fortnight of milliseconds is the default time after which we
// consider a version check to be stale. It's a big number, but we're
// still far away from the max at Number.MAX_SAFE_INTEGER
const STALE_VERSION_CHECK_TIME_IN_MS = 14*24*60*60*1000;

export class AdminPanel extends Disposable {
  private _page = Computed.create<AdminPanelPage>(this, (use) => use(urlState().state).adminPanel || 'admin');

  constructor(private _appModel: AppModel, private _appObj: App) {
    super();
    document.title = getAdminPanelName() + getPageTitleSuffix(getGristConfig());
  }

  public buildDom() {
    const pageObs = Computed.create(this, use => use(urlState().state).adminPanel || 'admin');
    return pagePanels({
      leftPanel: buildAdminLeftPanel(this, this._appModel),
      headerMain: this._buildMainHeader(pageObs),
      contentTop: buildHomeBanners(this._appModel),
      contentMain: this._buildMainContent(),
      app: this._appObj,
    });
  }


  private _buildMainHeader(pageObs: Computed<AdminPanelPage>) {
    const pageNames = getPageNames();
    return [
      cssBreadcrumbs({style: 'margin-left: 16px;'},
        cssLink(
          urlState().setLinkUrl({}),
          t('Grist Instance'),
        ),
        separator(' / '),
        dom('span', getAdminPanelName()),
        separator(' / '),
        dom('span', dom.domComputed(use => pageNames.pages[use(pageObs)].section)),
        separator(' / '),
        dom('span', dom.domComputed(use => pageNames.pages[use(pageObs)].name)),
      ),
      createTopBarHome(this._appModel),
    ];
  }

  private _buildMainContent() {
    return cssPageContainer(
      // Setting tabIndex allows selecting and copying text. This is helpful on admin pages, e.g.
      // to copy GRIST_BOOT_KEY or version number. But we don't set it for buidAdminData() pages
      // because it messes with focus in GridViews, and its unclear how to undo its effect.
      dom.attr('tabindex', use => use(this._page) === 'admin' ? '-1' : null as any),

      dom.domComputed(use => use(this._page) === 'admin', (isInstallationAdminPage) => {
        return isInstallationAdminPage ?
          dom.create(AdminInstallationPanel, this._appModel) :
          dom.create(buildAdminData, this._appModel);
      }),

      cssPageContainer.cls('-admin-pages', use => use(this._page) !== 'admin'),

      testId('admin-panel'),
    );
  }
}

class AdminInstallationPanel extends Disposable {
  private _supportGrist = SupportGristPage.create(this, this._appModel);
  private _toggleEnterprise = ToggleEnterpriseWidget.create(this, this._appModel.notifier);
  private _checks: AdminChecks;
  private readonly _installAPI: InstallAPI = new InstallAPIImpl(getHomeUrl());

  constructor(private _appModel: AppModel) {
    super();
    this._checks = new AdminChecks(this, this._installAPI);
  }

  public buildDom() {
    this._checks.fetchAvailableChecks().catch(err => {
      reportError(err);
    });

    // If probes are available, show the panel as normal.
    // Otherwise say it is unavailable, and describe a fallback
    // mechanism for access.
    return dom.maybe(use => use(this._checks.probes), (probes) => [
      (probes as any[]).length > 0
      ? this._buildMainContentForAdmin()
      : this._buildMainContentForOthers()
    ]);
  }

  /**
   * Show something helpful to those without access to the panel,
   * which could include a legit administrator if auth is misconfigured.
   */
  private _buildMainContentForOthers() {
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

  private _buildMainContentForAdmin() {
    return [
      dom.create(AdminSection, t('Support Grist'), [
        dom.create(AdminSectionItem, {
          id: 'telemetry',
          name: t('Telemetry'),
          description: t('Help us make Grist better'),
          value: dom.create(
            HidableToggle,
            this._supportGrist.getTelemetryOptInObservable(),
            {labelId: 'admin-panel-item-description-telemetry'}
          ),
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
          id: 'admins',
          name: t('Administrative accounts'),
          description: t('The users with administrative accounts'),
          value: this._buildAdminUsersDisplay(),
          expandedContent: this._buildAdminUsersDetail(),
        }),
        dom.create(AdminSectionItem, {
          id: 'sandboxing',
          name: t('Sandboxing'),
          description: t('Sandbox settings for data engine'),
          value: this._buildSandboxingDisplay(),
          expandedContent: this._buildSandboxingNotice(),
        }),
        dom.create(AdminSectionItem, {
          id: 'authentication',
          name: t('Authentication'),
          description: t('Current authentication method'),
          value: this._buildAuthenticationDisplay(),
          expandedContent: this._buildAuthenticationNotice(),
        }),
        dom.create(AdminSectionItem, {
          id: 'session',
          name: t('Session Secret'),
          description: t('Key to sign sessions with'),
          value: this._buildSessionSecretDisplay(),
          expandedContent: this._buildSessionSecretNotice(),
        })
      ]),
      this._buildAuditLogsSection(),
      dom.create(AdminSection, t('Version'), [
        dom.create(AdminSectionItem, {
          id: 'version',
          name: t('Current'),
          description: t('Current version of Grist'),
          value: cssValueLabel(t('Version {{versionNumber}}', {versionNumber: version.version})),
        }),
        this._maybeAddEnterpriseToggle(),
        dom.create(this._buildUpdates.bind(this)),
      ]),
      dom.create(AdminSection, t('Self Checks'), [
        this._buildProbeItems({
          showRedundant: false,
          showNovel: true,
        }),
        dom.create(AdminSectionItem, {
          id: 'probe-other',
          name: t('more...'),
          description: '',
          value: '',
          expandedContent: this._buildProbeItems({
            showRedundant: true,
            showNovel: false,
          }),
        }),
      ]),
    ];
  }

  private _maybeAddEnterpriseToggle() {

    if (!showEnterpriseToggle()) {
      return null;
    }

    let makeToggle = () => dom.create(
      HidableToggle,
      this._toggleEnterprise.getEnterpriseToggleObservable(),
      {labelId: 'admin-panel-item-description-enterprise'}
    );

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

  private _buildSandboxingDisplay() {
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

  private _buildAdminUsersComputed(
    use: UseCBOwner,
    renderSuccess: (users: InstallAdminInfo[]) => Element
  ) {
    const req = this._checks.requestCheckById(use, 'admins');
    const result = req ? use(req.result) : undefined;
    const success = result?.status === 'success';

    if (!result) {
      return t('checking');
    }

    if (!success) {
      return cssErrorText(t('Error'));
    }

    const users: InstallAdminInfo[] = result?.details?.users || [];
    return renderSuccess(users);
  }

  private _buildAdminUsersDisplay() {
    return cssValueLabel(
      dom.domComputed(
        use => this._buildAdminUsersComputed(use, (users) => {
          const actualUsers = users.filter(detail => detail.user !== null);
          if (actualUsers.length > 0) {
            return cssHappyText(t('{{count}} admin accounts', {count: actualUsers.length}));
          }
          return cssErrorText(t('no admin accounts'));
        })
      ),
      testId('admin-panel-admin-accounts-display')
    );
  }

  private _buildAdminUsersDetail() {
    return dom.domComputed(
      use => this._buildAdminUsersComputed(use, (users) => {
        return cssAdminAccountList(
          users.map(({user, reason}) => {
            const userDisplay = user ? cssUserInfo(
              createUserImage(user, 'medium'),
              cssUserName(dom('span', user.name, testId('admin-panel-admin-account-name')),
                cssEmail(user.email, testId('admin-panel-admin-account-email'))
              )
            ) : cssErrorText(t('Admin account not found'));
            return cssAdminAccountListItem([
              cssAdminAccountItemPart(userDisplay),
              cssAdminAccountItemPart(cssAdminAccountReason(markdown(reason, {inline: true})))
            ], testId(`admin-panel-admin-accounts-list-item`));
          }),
          testId(`admin-panel-admin-accounts-list`)
        );
      })
    );
  }

  private _buildAuthenticationDisplay() {
    return dom.domComputed(
      use => {
        const req = this._checks.requestCheckById(use, 'authentication');
        const result = req ? use(req.result) : undefined;
        if (!result) {
          return cssValueLabel(cssErrorText(t('unavailable')));
        }

        const { status, details } = result;
        const success = status === 'success';
        const loginSystemId = details?.loginSystemId;

        if (!success || !loginSystemId) {
          return cssValueLabel(cssErrorText(t('auth error')));
        }

        if (loginSystemId === 'no-logins') {
          return cssValueLabel(cssDangerText(t('no authentication')));
        }

        return cssValueLabel(cssHappyText(loginSystemId));
      }
    );
  }

  private _buildAuthenticationNotice() {
    return t('Grist allows different types of authentication to be configured, including SAML and OIDC. \
We recommend enabling one of these if Grist is accessible over the network or being made available \
to multiple people.');
  }

  private _buildSessionSecretDisplay() {
    return dom.domComputed(
      use => {
        const req = this._checks.requestCheckById(use, 'session-secret');
        const result = req ? use(req.result) : undefined;

        if (result?.status === 'warning') {
          return cssValueLabel(cssDangerText(t('default')));
        }

        return cssValueLabel(cssHappyText(t('configured')));
      }
    );
  }

  private _buildSessionSecretNotice() {
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

    const config = getGristConfig();
    const latestVersionAvailable = Observable.create(owner, config.latestVersionAvailable);
    const checkForLatestVersion = Observable.create(owner, true);
    const allowAutomaticVersionChecking = Observable.create(owner, config.automaticVersionCheckingAllowed);
    this._installAPI.getInstallPrefs()
      .then((prefs) => {
        if (this.isDisposed() || checkForLatestVersion.isDisposed()) { return; }
        checkForLatestVersion.set(prefs.checkForLatestVersion ?? true);
      })
      .catch(reportError);

    // Observable state of the updates check.
    const state: Observable<State> = Observable.create(owner, State.NEVER);

    // The background task that checks for updates, can be disposed (cancelled) when needed.
    let backgroundTask: IDisposable|null = null;

    // By default we link to the Docker Hub releases page, but the
    // endpoint might say something different.
    const releaseURL = 'https://hub.docker.com/r/gristlabs/grist';

    // All the events that might occur
    const actions = {
      checkForUpdates: async () => {
        state.set(State.CHECKING);
        latestVersionAvailable.set(undefined);
        // We can be disabled, while the check is in progress.
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
        this._installAPI.updateInstallPrefs({checkForLatestVersion: false}).catch(reportError);
        checkForLatestVersion.set(false);
      },
      enableAutoCheck: () => {
        if (state.get() !== State.CHECKING) {
          actions.checkForUpdates().catch(reportError);
          this._installAPI.updateInstallPrefs({checkForLatestVersion: true}).catch(reportError);
          checkForLatestVersion.set(true);
        }
      },
      gotLatestVersion: (data: LatestVersionAvailable) => {
        latestVersionAvailable.set(data);
        if (data.isNewer) {
          state.set(State.AVAILABLE);
        } else {
          state.set(State.CURRENT);
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
          const lastCheck = latestVersionAvailable.get()?.dateChecked;
          return lastCheck ?
            t('Last checked {{time}}', {time: getTimeFromNow(lastCheck)})
            : t('No record of last version check');
        }
      }
    });

    // Now trigger the initial state
    const lastCheck = latestVersionAvailable.get()?.dateChecked;
    if (lastCheck) {
      if (Date.now() - lastCheck > STALE_VERSION_CHECK_TIME_IN_MS) {
        // It's been too long since we last checked
        state.set(State.STALE);
      } else if (latestVersionAvailable.get()?.isNewer === true) {
        state.set(State.AVAILABLE);
      } else if (latestVersionAvailable.get()?.isNewer === false) {
        state.set(State.CURRENT);
      }
    }
    else {
      state.set(State.NEVER);
    }

    // Toggle component operates on a boolean observable, without a way to set the value. So
    // create a controller for it to intercept the write and call the appropriate action.
    const enabledController = Computed.create(owner, (use) => use(checkForLatestVersion));
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

          if (use(latestVersionAvailable)) {
            return cssValueLabel(
              `Version ${use(latestVersionAvailable)?.version}`,
              testId('admin-panel-updates-version')
            );
          }

          throw new Error('Invalid state');
        })
      ),
      expandedContent: dom('div',
        cssExpandedContent(
          dom.domComputed(use => dom('div', t('Grist releases are at '),
            makeLinks(use(latestVersionAvailable)?.releaseUrl || releaseURL)
          )),
        ),
        dom.maybe(latestVersionAvailable, latest => cssExpandedContent(
          dom('div',
            dom('span', t('Last checked {{time}}', {
              time: getTimeFromNow(latest.dateChecked)
            })),
            dom('span', ' '),
            // Format date in local format.
            cssGrayed(`(${new Date(latest.dateChecked).toLocaleString()})`),
          ),
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
          ])
        )),
        dom.domComputed(allowAutomaticVersionChecking, (allowAutomaticChecks) =>
          allowAutomaticChecks ? cssExpandedContent(
            dom('label', t('Auto-check weekly'), {for: 'admin-panel-updates-auto-check-switch'}),
            dom('div', toggleSwitch(enabledController, {
              args: [testId('admin-panel-updates-auto-check')],
              inputArgs: [{id: 'admin-panel-updates-auto-check-switch'}],
            }))
          ) :
          cssExpandedContent(
            dom('span', t('Automatic checks are disabled. \
Set the environment variable GRIST_ALLOW_AUTOMATIC_VERSION_CHECKING to "true" to enable them.'),
            testId('admin-panel-updates-auto-check-disabled')),
          )
        )),
    });
  }

  /**
   * Show the results of various checks. Of the checks, some are considered
   * "redundant" (already covered elsewhere in the Admin Panel) and the
   * remainder are "novel".
   */
  private _buildProbeItems(options: {
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
          return this._buildProbeItem(req.probe, use(req.result), req.details);
        }),
      ]
    );
  }

  /**
   * Show the result of an individual check.
   */
  private _buildProbeItem(info: BootProbeInfo,
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
          "You can set up streaming of audit events from Grist to an \
external security information and event management (SIEM) \
system if you enable Grist Enterprise. {{contactUsLink}} to \
learn more.",
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
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: auto;
  padding: 40px;
  font-size: ${vars.introFontSize};
  color: ${theme.text};
  outline: none;

  &-admin-pages {
    padding: 12px;
    font-size: ${vars.mediumFontSize};
  }

  @media ${mediaSmall} {
    & {
      padding: 0px;
      font-size: ${vars.mediumFontSize};
    }
  }
`);

const cssExpandedContent = styled('div', `
  display: flex;
  justify-content: space-between;
  margin-right: 8px;
  margin-bottom: 1rem;
  align-items: center;
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

const cssDangerText = styled('div', `
  color: ${theme.dangerText};
`);

const cssHappyText = styled('span', `
  color: ${theme.controlFg};
`);

const cssLabel = styled('div', `
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

const cssAdminAccountList = styled('ul', `
  list-style: none;
  padding: 0;
  max-width: 700px;
  margin: 0 auto;
`);

const cssAdminAccountListItem = styled('li', `
  padding: 1rem 0rem;
  margin: 0rem 1.2rem;
  display: flex;
  align-items: center;
  &:not(:first-child) {
    border-top: 1px solid ${theme.widgetBorder};
  }
`);

const cssAdminAccountReason = styled('span', `
  font-size: 0.9rem;
  font-weight: 500;
  display: inherit;
`);

const cssAdminAccountItemPart = styled('span', `
  width: 50%;
  &>:not(div) {
    padding: 12px 24px 12px 16px;
  }
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
