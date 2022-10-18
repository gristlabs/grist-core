import {AppModel, reportError} from 'app/client/models/AppModel';
import {urlState} from 'app/client/models/gristUrlState';
import * as css from 'app/client/ui/AccountPageCss';
import {ApiKey} from 'app/client/ui/ApiKey';
import {AppHeader} from 'app/client/ui/AppHeader';
import {buildChangePasswordDialog} from 'app/client/ui/ChangePasswordDialog';
import {leftPanelBasic} from 'app/client/ui/LeftPanelCommon';
import {MFAConfig} from 'app/client/ui/MFAConfig';
import {pagePanels} from 'app/client/ui/PagePanels';
import {ThemeConfig} from 'app/client/ui/ThemeConfig';
import {createTopBarHome} from 'app/client/ui/TopBar';
import {transientInput} from 'app/client/ui/transientInput';
import {cssBreadcrumbs, separator} from 'app/client/ui2018/breadcrumbs';
import {labeledSquareCheckbox} from 'app/client/ui2018/checkbox';
import {cssLink} from 'app/client/ui2018/links';
import {getGristConfig} from 'app/common/urlUtils';
import {FullUser} from 'app/common/UserAPI';
import {Computed, Disposable, dom, domComputed, makeTestId, Observable, styled} from 'grainjs';
import {t} from 'app/client/lib/localization';

const testId = makeTestId('test-account-page-');
const translate = (x: string, args?: any): string => t(`AccountPage.${x}`, args);

/**
 * Creates the account page where a user can manage their profile settings.
 */
export class AccountPage extends Disposable {
  private _apiKey = Observable.create<string>(this, '');
  private _userObs = Observable.create<FullUser|null>(this, null);
  private _isEditingName = Observable.create(this, false);
  private _nameEdit = Observable.create<string>(this, '');
  private _isNameValid = Computed.create(this, this._nameEdit, (_use, val) => checkName(val));
  private _allowGoogleLogin = Computed.create(this, (use) => use(this._userObs)?.allowGoogleLogin ?? false)
    .onWrite((val) => this._updateAllowGooglelogin(val));

  constructor(private _appModel: AppModel) {
    super();
    this._fetchAll().catch(reportError);
  }

  public buildDom() {
    const panelOpen = Observable.create(this, false);
    return pagePanels({
      leftPanel: {
        panelWidth: Observable.create(this, 240),
        panelOpen,
        hideOpener: true,
        header: dom.create(AppHeader, this._appModel.currentOrgName, this._appModel),
        content: leftPanelBasic(this._appModel, panelOpen),
      },
      headerMain: this._buildHeaderMain(),
      contentMain: this._buildContentMain(),
      testId,
    });
  }

  private _buildContentMain() {
    const {enableCustomCss} = getGristConfig();
    return domComputed(this._userObs, (user) => user && (
      css.container(css.accountPage(
        css.header(translate('AccountSettings')),
        css.dataRow(
          css.inlineSubHeader(translate('Email')),
          css.email(user.email),
        ),
        css.dataRow(
          css.inlineSubHeader(translate('Name')),
          domComputed(this._isEditingName, (isEditing) => (
            isEditing ? [
              transientInput(
                {
                  initialValue: user.name,
                  save: (val) => this._isNameValid.get() && this._updateUserName(val),
                  close: () => { this._isEditingName.set(false); this._nameEdit.set(''); },
                },
                { size: '5' }, // Lower size so that input can shrink below ~152px.
                dom.on('input', (_ev, el) => this._nameEdit.set(el.value)),
                css.flexGrow.cls(''),
              ),
              css.textBtn(
                css.icon('Settings'), translate('Save'),
                // No need to save on 'click'. The transient input already does it on close.
              ),
            ] : [
              css.name(user.name),
              css.textBtn(
                css.icon('Settings'), translate('Edit'),
                dom.on('click', () => this._isEditingName.set(true)),
              ),
            ]
          )),
          testId('username'),
        ),
        // show warning for invalid name but not for the empty string
        dom.maybe(use => use(this._nameEdit) && !use(this._isNameValid), cssWarnings),
        css.header(translate('PasswordSecurity')),
        css.dataRow(
          css.inlineSubHeader(translate("LoginMethod")),
          css.loginMethod(user.loginMethod),
          user.loginMethod === 'Email + Password' ? css.textBtn(translate("ChangePassword"),
            dom.on('click', () => this._showChangePasswordDialog()),
          ) : null,
          testId('login-method'),
        ),
        user.loginMethod !== 'Email + Password' ? null : dom.frag(
          css.dataRow(
            labeledSquareCheckbox(
              this._allowGoogleLogin,
              translate('AllowGoogleSigning'),
              testId('allow-google-login-checkbox'),
            ),
            testId('allow-google-login'),
          ),
          css.subHeader(translate('TwoFactorAuth')),
          css.description(
            translate("TwoFactorAuthDescription")
          ),
          dom.create(MFAConfig, user),
        ),
        // Custom CSS is incompatible with custom themes.
        enableCustomCss ? null : [
          css.header(translate('Theme')),
          dom.create(ThemeConfig, this._appModel),
        ],
        css.header(translate('API')),
        css.dataRow(css.inlineSubHeader(translate('APIKey')), css.content(
          dom.create(ApiKey, {
            apiKey: this._apiKey,
            onCreate: () => this._createApiKey(),
            onDelete: () => this._deleteApiKey(),
            anonymous: false,
            inputArgs: [{ size: '5' }], // Lower size so that input can shrink below ~152px.
          })
        )),
      ),
      testId('body'),
    )));
  }

  private _buildHeaderMain() {
    return dom.frag(
      cssBreadcrumbs({ style: 'margin-left: 16px;' },
        cssLink(
          urlState().setLinkUrl({}),
          'Home',
          testId('home'),
        ),
        separator(' / '),
        dom('span', 'Account'),
      ),
      createTopBarHome(this._appModel),
    );
  }

  private async _fetchApiKey() {
    this._apiKey.set(await this._appModel.api.fetchApiKey());
  }

  private async _createApiKey() {
    this._apiKey.set(await this._appModel.api.createApiKey());
  }

  private async _deleteApiKey() {
    await this._appModel.api.deleteApiKey();
    this._apiKey.set('');
  }

  private async _fetchUserProfile() {
    this._userObs.set(await this._appModel.api.getUserProfile());
  }

  private async _fetchAll() {
    await Promise.all([
      this._fetchApiKey(),
      this._fetchUserProfile(),
    ]);
  }

  private async _updateUserName(val: string) {
    const user = this._userObs.get();
    if (user && val && val === user.name) { return; }

    await this._appModel.api.updateUserName(val);
    await this._fetchAll();
  }

  private async _updateAllowGooglelogin(allowGoogleLogin: boolean) {
    await this._appModel.api.updateAllowGoogleLogin(allowGoogleLogin);
    await this._fetchUserProfile();
  }

  private _showChangePasswordDialog() {
    return buildChangePasswordDialog();
  }
}

/**
 * We allow alphanumeric characters and certain common whitelisted characters (except at the start),
 * plus everything non-ASCII (for non-English alphabets, which we want to allow but it's hard to be
 * more precise about what exactly to allow).
 */
// eslint-disable-next-line no-control-regex
const VALID_NAME_REGEXP = /^(\w|[^\u0000-\u007F])(\w|[- ./'"()]|[^\u0000-\u007F])*$/;

/**
 * Test name against various rules to check if it is a valid username.
 */
export function checkName(name: string): boolean {
  return VALID_NAME_REGEXP.test(name);
}

/**
 * Builds dom to show marning messages to the user.
 */
function buildNameWarningsDom() {
  return css.warning(
    translate("WarningUsername"),
    testId('username-warning'),
  );
}

const cssWarnings = styled(buildNameWarningsDom, `
  margin: -8px 0 0 110px;
`);
