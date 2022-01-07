import {AppModel, reportError} from 'app/client/models/AppModel';
import {getResetPwdUrl, urlState} from 'app/client/models/gristUrlState';
import {ApiKey} from 'app/client/ui/ApiKey';
import {AppHeader} from 'app/client/ui/AppHeader';
import {leftPanelBasic} from 'app/client/ui/LeftPanelCommon';
// import {MFAConfig} from 'app/client/ui/MFAConfig';
import {pagePanels} from 'app/client/ui/PagePanels';
import {createTopBarHome} from 'app/client/ui/TopBar';
import {transientInput} from 'app/client/ui/transientInput';
import {buildNameWarningsDom, checkName} from 'app/client/ui/WelcomePage';
import {bigBasicButton, bigPrimaryButtonLink} from 'app/client/ui2018/buttons';
import {cssBreadcrumbs, cssBreadcrumbsLink, separator} from 'app/client/ui2018/breadcrumbs';
import {icon} from 'app/client/ui2018/icons';
import {cssModalBody, cssModalButtons, cssModalTitle, modal} from 'app/client/ui2018/modals';
import {colors, vars} from 'app/client/ui2018/cssVars';
import {FullUser, /*UserMFAPreferences*/} from 'app/common/UserAPI';
import {Computed, Disposable, dom, domComputed, makeTestId, Observable, styled} from 'grainjs';

const testId = makeTestId('test-account-page-');

/**
 * Creates the account page where a user can manage their profile settings.
 */
export class AccountPage extends Disposable {
  private _apiKey = Observable.create<string>(this, '');
  private _userObs = Observable.create<FullUser|null>(this, null);
  // private _userMfaPreferences = Observable.create<UserMFAPreferences|null>(this, null);
  private _isEditingName = Observable.create(this, false);
  private _nameEdit = Observable.create<string>(this, '');
  private _isNameValid = Computed.create(this, this._nameEdit, (_use, val) => checkName(val));

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
    });
  }

  private _buildContentMain() {
    return domComputed(this._userObs, (user) => user && (
      cssContainer(cssAccountPage(
        cssHeader('Account settings'),
        cssDataRow(cssSubHeader('Email'), user.email),
        cssDataRow(
          cssSubHeader('Name'),
          domComputed(this._isEditingName, (isEditing) => (
            isEditing ? [
              transientInput(
                {
                  initialValue: user.name,
                  save: (val) => this._isNameValid.get() && this._updateUserName(val),
                  close: () => { this._isEditingName.set(false); this._nameEdit.set(''); },
                },
                dom.on('input', (_ev, el) => this._nameEdit.set(el.value)),
              ),
              cssTextBtn(
                cssIcon('Settings'), 'Save',
                // No need to save on 'click'. The transient input already does it on close.
              ),
            ] : [
              user.name,
              cssTextBtn(
                cssIcon('Settings'), 'Edit',
                dom.on('click', () => this._isEditingName.set(true)),
              ),
            ]
          )),
          testId('username'),
        ),
        // show warning for invalid name but not for the empty string
        dom.maybe(use => use(this._nameEdit) && !use(this._isNameValid), cssWarnings),
        cssHeader('Password & Security'),
        cssDataRow(
          cssSubHeader('Login Method'),
          user.loginMethod,
          // TODO: should show btn only when logged in with google
          user.loginMethod === 'Email + Password' ? cssTextBtn(
            // rename to remove mention of Billing in the css
            cssIcon('Settings'), 'Reset',
            dom.on('click', () => confirmPwdResetModal(user.email)),
          ) : null,
          testId('login-method'),
        ),
        // user.loginMethod !== 'Email + Password' ? null : dom.frag(
        //   cssSubHeaderFullWidth('Two-factor authentication'),
        //   cssDescription(
        //     "Two-factor authentication is an extra layer of security for your Grist account designed " +
        //     "to ensure that you're the only person who can access your account, even if someone " +
        //     "knows your password."
        //   ),
        //   dom.create(MFAConfig, this._userMfaPreferences, {
        //     user,
        //     appModel: this._appModel,
        //   }),
        // ),
        cssHeader('API'),
        cssDataRow(cssSubHeader('API Key'), cssContent(
          dom.create(ApiKey, {
            apiKey: this._apiKey,
            onCreate: () => this._createApiKey(),
            onDelete: () => this._deleteApiKey(),
            anonymous: false,
          })
        )),
      ),
      testId('body'),
    )));
  }

  private _buildHeaderMain() {
    return dom.frag(
      cssBreadcrumbs({ style: 'margin-left: 16px;' },
        cssBreadcrumbsLink(
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

  // private async _fetchUserMfaPreferences() {
  //   this._userMfaPreferences.set(await this._appModel.api.getUserMfaPreferences());
  // }

  private async _fetchAll() {
    await Promise.all([
      // this._fetchUserMfaPreferences(),
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
}

function confirmPwdResetModal(userEmail: string) {
  return modal((ctl, _owner) => {
    return [
      cssModalTitle('Reset Password'),
      cssModalBody(`Click continue to open the password reset form. Submit it for your email address: ${userEmail}`),
      cssModalButtons(
        bigPrimaryButtonLink(
          { href: getResetPwdUrl(), target: '_blank' },
          'Continue',
          dom.on('click', () => ctl.close()),
        ),
        bigBasicButton(
          'Cancel',
          dom.on('click', () => ctl.close()),
        ),
      ),
    ];
  });
}

const cssContainer = styled('div', `
  display: flex;
  justify-content: center;
  overflow: auto;
`);

const cssHeader = styled('div', `
  height: 32px;
  line-height: 32px;
  margin: 28px 0 16px 0;
  color: ${colors.dark};
  font-size: ${vars.xxxlargeFontSize};
  font-weight: ${vars.headerControlTextWeight};
`);

const cssAccountPage = styled('div', `
  max-width: 600px;
  padding: 32px 64px 24px 64px;
`);

const cssDataRow = styled('div', `
  margin: 8px 0px;
  display: flex;
  align-items: baseline;
`);

const cssSubHeaderFullWidth = styled('div', `
  padding: 8px 0;
  display: inline-block;
  vertical-align: top;
  font-weight: bold;
`);

const cssSubHeader = styled(cssSubHeaderFullWidth, `
  width: 110px;
`);

const cssContent = styled('div', `
  flex: 1 1 300px;
`);

const cssTextBtn = styled('button', `
  font-size: ${vars.mediumFontSize};
  color: ${colors.lightGreen};
  cursor: pointer;
  margin-left: auto;
  background-color: transparent;
  border: none;
  padding: 0;
  text-align: left;
  width: 90px;

  &:hover {
    color: ${colors.darkGreen};
  }
`);

const cssIcon = styled(icon, `
  background-color: ${colors.lightGreen};
  margin: 0 4px 2px 0;

  .${cssTextBtn.className}:hover > & {
    background-color: ${colors.darkGreen};
  }
`);

const cssWarnings = styled(buildNameWarningsDom, `
  margin: -8px 0 0 110px;
`);

// const cssDescription = styled('div', `
//   color: #8a8a8a;
//   font-size: 13px;
// `);
