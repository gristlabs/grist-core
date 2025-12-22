import {makeT} from 'app/client/lib/localization';
import {cssMarkdownSpan} from 'app/client/lib/markdown';
import {getHomeUrl, reportError} from 'app/client/models/AppModel';
import {AdminPanelControls, cssIconWrapper, cssWell, cssWellContent} from 'app/client/ui/AdminPanelCss';
import {basicButton, bigPrimaryButton} from 'app/client/ui2018/buttons';
import {theme, vars} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {confirmModal, cssModalWidth, modal} from 'app/client/ui2018/modals';
import {AuthProvider, ConfigAPI} from 'app/common/ConfigAPI';
import {
  FORWARDAUTH_PROVIDER_KEY,
  GRIST_CONNECT_PROVIDER_KEY,
  MINIMAL_PROVIDER_KEY,
  OIDC_PROVIDER_KEY,
  SAML_PROVIDER_KEY
} from 'app/common/loginProviders';
import {Disposable, dom, makeTestId, Observable, styled} from 'grainjs';

const t = makeT('AdminPanel');

const testId = makeTestId('test-admin-auth-');

export class AuthenticationSection extends Disposable {
  private _providers = Observable.create<AuthProvider[]>(this, []);
  private _configAPI = new ConfigAPI(getHomeUrl());

  constructor(
    private _loginSystemId: Observable<string | undefined>,
    private _controls: AdminPanelControls
  ) {
    super();
    this._fetchProviders().catch(reportError);
  }

  public buildDom() {
    return [
      dom.maybe(use => use(this._loginSystemId) === MINIMAL_PROVIDER_KEY, () => [
        cssWell(
          dom.style('margin-bottom', '24px'),
          cssWell.cls('-warning'),
          cssIconWrapper(icon('Warning')),
          cssWellContent(
            dom('p', t('No authentication method is active.')),
            dom('p', t('If Grist is accessible on your network, or is available to multiple people, ' +
              'we strongly recommend configuring one of the methods below as the active method.'))
          )
        )
      ]),
      dom.domComputed(this._providers, providers => this._buildListOfProviders(providers)),
    ];
  }

  private async _fetchProviders() {
    const providers = await this._configAPI.getAuthProviders();
    if (this.isDisposed()) {
      return;
    }
    this._providers.set(providers);
    // Check if restart is needed (when current and active diverge)
    const needsRestart = providers.some(p => p.willBeActive);
    if (needsRestart) {
      this._controls.needsRestart.set(true);
    }
  }

  private _buildListOfProviders(providers: AuthProvider[]) {
    return cssMethodsContainer(
      providers.map(provider => {
        return cssMethodRow(
          testId(`provider-row-${provider.key.replace('.', '-')}`),
          testId(`provider-row`),
          cssMethodContent(
            cssMethodLabel(provider.name),
            // Render badges based on server-calculated badge list
            provider.isConfigured
              ? cssMethodBadge(
                t('Configured'),
                testId('badge'),
                testId('badge-configured'),
              )
              : null,
            provider.isActive
              ? cssMethodBadge(t('Active'), cssMethodBadge.cls('-primary'), testId('badge'), testId('badge-active'))
              : null,
            provider.willBeActive
              ? cssMethodBadge(
                t('Active on restart'),
                cssMethodBadge.cls('-warning'),
                testId('badge'),
                testId('badge-active-on-restart'))
              : null,
            provider.willBeDisabled
              ? cssMethodBadge(
                t('Disabled on restart'),
                cssMethodBadge.cls('-warning'),
                testId('badge'),
                testId('badge-disabled-on-restart'))
              : null,
            (provider.configError || provider.activeError)
              ? cssMethodBadge(
                t('Error'),
                cssMethodBadge.cls('-error'),
                testId('badge'),
                testId('badge-error'))
              : null,
            cssFlex(),
            // Show "Set as active method" button only if configured but not active
            // and no provider is configured via environment variable
            provider.canBeActivated ?
              basicButton(
                t('Set as active method'),
                testId(`set-active-button`),
                dom.on('click', () => this._setActiveProvider(provider)),
              ) : null,
            // Always show Configure button
            basicButton(
              t('Configure'),
              testId('configure-button'),
              testId(`configure-${provider.name.toLowerCase().replace(/\s+/g, '-')}`),
              dom.on('click', () => this._configureProvider(provider)),
            ),
          ),
          // Show error message if present
          (provider.configError || provider.activeError) ?
            dom('div',
              cssErrorHeader(t('Error details'), testId('error-header')),
              provider.activeError ? cssMethodError(provider.activeError, testId('error-message')) : null,
              provider.configError ? cssMethodError(provider.configError, testId('error-message')) : null,
            ) : null,
          // Show info message if configured via environment variable
          provider.isSelectedByEnv ?
            cssMethodInfo(
              t('Active method is controlled by an environment variable. Unset variable to change active method.')
            ) : null
        );
      })
    );
  }

  private async _setActiveProvider(provider: AuthProvider) {
    confirmModal(
      t('Set as active method?'),
      t('Confirm'),
      async () => {
        await this._configAPI.setActiveAuthProvider(provider.key);
        await this._fetchProviders();
      },
      {
        explanation: dom('div',
          cssMarkdownSpan(
            t('Are you sure you want to set **{{name}}** as the active authentication method?',
              {name: provider.name})
          ),
          dom('p',
            t('The new method will go into effect after you restart Grist.'),
          ),
        ),
      }
    );
  }

  private _configureProvider(provider: AuthProvider) {
    const configModal = BaseInformationModal.for(provider);
    if (configModal) {
      configModal.show();
      this.onDispose(() => configModal.isDisposed() ? void 0 : configModal.dispose());
    }
  }
}


/**
 * Base class for displaying static information about authentication providers.
 */
abstract class BaseInformationModal extends Disposable {
  /**
   * Factory method to create the appropriate modal for a provider.
   */
  public static for(provider: AuthProvider): BaseInformationModal | null {
    switch (provider.key) {
      case OIDC_PROVIDER_KEY:
        return new OIDCInformationModal(provider);
      case SAML_PROVIDER_KEY:
        return new SAMLInformationModal(provider);
      case FORWARDAUTH_PROVIDER_KEY:
        return new ForwardedHeadersInfoModal(provider);
      case GRIST_CONNECT_PROVIDER_KEY:
        return new GristConnectInfoModal(provider);
      default:
        throw new Error(`No configuration modal available for provider key: ${provider.key}`);
    }
  }

  constructor(protected _provider: AuthProvider) {
    super();
  }

  public show() {
    return modal((ctl, owner) => [
      () => {
        this.onDispose(() => {
          if (owner.isDisposed()) {
            return;
          }
          ctl.close();
        });
        return null;
      },
      cssModalWidth('fixed-wide'),
      cssModalHeader(
        dom('span', t(`Configure ${this._provider.name}`)),
        testId('modal-header'),
      ),
      cssModalDescription(
        ...this.getDescription().map(desc => dom('p', cssMarkdownSpan(desc)))
      ),
      cssModalInstructions(
        dom('h3', t('Instructions')),
        cssMarkdownSpan(this.getInstruction())
      ),
      cssModalButtons(
        bigPrimaryButton(
          t('Close'),
          dom.on('click', () => this.dispose()),
          testId('modal-cancel'),
          testId('modal-close'),
        ),
      ),
    ]);
  }

  protected abstract getDescription(): string[];
  protected abstract getInstruction(): string;
}

/**
 * Modal for configuring OIDC authentication.
 */
class OIDCInformationModal extends BaseInformationModal {
  protected getDescription(): string[] {
    return [
      t('**OIDC** allows users on your Grist server to sign in using an external identity provider that ' +
        'supports the OpenID Connect standard.'),
      t('When signing in, users will be redirected to your chosen identity provider\'s login page to ' +
        'authenticate. After successful authentication, they\'ll be redirected back to your Grist server and ' +
        'signed in as the user verified by the provider.')
    ];
  }

  protected getInstruction(): string {
    return t('To set up **OIDC**, follow the instructions in ' +
      '[the Grist support article for OIDC](https://support.getgrist.com/install/oidc).');
  }
}

/**
 * Modal for configuring SAML authentication.
 */
class SAMLInformationModal extends BaseInformationModal {
  protected getDescription(): string[] {
    return [
      t('**SAML** allows users on your Grist server to sign in using an external identity provider that ' +
        'supports the SAML 2.0 standard.'),
      t('When signing in, users will be redirected to your chosen identity provider\'s login page to ' +
        'authenticate. After successful authentication, they\'ll be redirected back to your Grist server and ' +
        'signed in as the user verified by the provider.')
    ];
  }

  protected getInstruction(): string {
    return t('To set up **SAML**, follow the instructions in ' +
      '[the Grist support article for SAML](https://support.getgrist.com/install/saml/).');
  }
}

/**
 * Modal for configuring forwarded headers authentication.
 */
class ForwardedHeadersInfoModal extends BaseInformationModal {
  protected getDescription(): string[] {
    return [
      t('**Forwarded headers** allows your Grist server to trust authentication performed by an external ' +
        'proxy (e.g. Traefik ForwardAuth).'),
      t('When a user accesses Grist, the proxy handles authentication and forwards verified user information ' +
        'through HTTP headers. Grist uses these headers to identify the user.')
    ];
  }

  protected getInstruction(): string {
    return t('To set up **forwarded headers**, follow the instructions in ' +
      '[the Grist support article for forwarded headers](https://support.getgrist.com/install/forwarded-headers/).');
  }
}

/**
 * Modal for configuring Grist Connect authentication.
 */
class GristConnectInfoModal extends BaseInformationModal {
  protected getDescription(): string[] {
    return [
      t('**Grist Connect** is a login solution built and maintained by Grist Labs that integrates seamlessly ' +
        'with your Grist server.'),
      t('When signing in, users will be redirected to a Grist Connect login page where they can authenticate ' +
        'using various identity providers. After authentication, they\'ll be redirected back to your Grist server ' +
        'and signed in.')
    ];
  }

  protected getInstruction(): string {
    return t('To set up **Grist Connect**, follow the instructions in ' +
      '[the Grist support article for Grist Connect](https://support.getgrist.com/install/grist-connect/).');
  }
}

const cssMethodsContainer = styled('div', `
  display: flex;
  flex-direction: column;
  border: 1px solid ${theme.menuBorder};
  border-radius: 8px;
  overflow: hidden;
`);

const cssMethodRow = styled('div', `
  display: flex;
  gap: 16px;
  flex-direction: column;
  padding: 16px;
  background-color: ${theme.mainPanelBg};
  border-bottom: 1px solid ${theme.menuBorder};
  &:last-child {
    border-bottom: none;
  }
`);

const cssMethodContent = styled('div', `
  display: flex;
  flex-direction: row;
  align-items: center;
  flex: 1;
  gap: 12px;
`);

const cssMethodInfo = styled('div', `
  color: ${theme.lightText};
`);

const cssMethodError = styled('div', `
  color: ${theme.errorText};
  margin-top: 4px;
`);

const cssErrorHeader = styled('div', `
  color: ${theme.errorText};
  font-weight: 600;
  font-size: ${vars.smallFontSize};
  margin-top: 8px;
  margin-bottom: 4px;
`);

const cssMethodLabel = styled('div', `
  font-size: ${vars.mediumFontSize};
  color: ${theme.text};
`);

const cssMethodBadge = styled('div', `
  padding: 2px 8px;
  color: ${theme.lightText};
  border: 1px solid ${theme.lightText};
  font-size: ${vars.xsmallFontSize};
  font-weight: 600;
  border-radius: 16px;
  text-transform: uppercase;
  white-space: nowrap;
  &-primary {
    border-color: ${theme.controlPrimaryBg};
    color: ${theme.controlPrimaryBg};
  }
  &-warning {
    border-color: #ffb535;
    color: ${theme.toastWarningBg}
  }
  &-error {
    border-color: ${theme.errorText};
    color: ${theme.errorText};
  }
`);

const cssFlex = styled('div', `
  flex: 1;
`);

const cssModalHeader = styled('div', `
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 24px;
  font-size: ${vars.xxxlargeFontSize};
  font-weight: 500;
  color: ${theme.text};
`);

const cssModalDescription = styled('div', `
  margin-bottom: 24px;
  color: ${theme.text};
  font-size: ${vars.mediumFontSize};
  line-height: 1.5;

  & > p {
    margin: 0 0 12px 0;
  }

  & > p:last-child {
    margin-bottom: 0;
  }
`);

const cssModalInstructions = styled('div', `
  margin-bottom: 16px;

  & > h3 {
    margin: 0 0 12px 0;
    font-size: ${vars.largeFontSize};
    font-weight: 600;
    color: ${theme.text};
  }

  & > p {
    margin: 0;
    color: ${theme.text};
    font-size: ${vars.mediumFontSize};
    line-height: 1.5;
  }
`);

const cssModalButtons = styled('div', `
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 24px;
`);
