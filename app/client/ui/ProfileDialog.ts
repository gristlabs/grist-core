import {AppModel, reportError} from 'app/client/models/AppModel';
import {getResetPwdUrl} from 'app/client/models/gristUrlState';
import {ApiKey} from 'app/client/ui/ApiKey';
import * as billingPageCss from 'app/client/ui/BillingPageCss';
import {transientInput} from 'app/client/ui/transientInput';
import {buildNameWarningsDom, checkName} from 'app/client/ui/WelcomePage';
import {bigBasicButton, bigPrimaryButton, bigPrimaryButtonLink} from 'app/client/ui2018/buttons';
import {testId} from 'app/client/ui2018/cssVars';
import {cssModalBody, cssModalButtons, cssModalTitle, cssModalWidth} from 'app/client/ui2018/modals';
import {IModalControl, modal} from 'app/client/ui2018/modals';
import {FullUser} from 'app/common/LoginSessionAPI';
import {Computed, dom, domComputed, DomElementArg, MultiHolder, Observable, styled} from 'grainjs';


/**
 * Renders a modal with profile settings.
 */
export function showProfileModal(appModel: AppModel): void {
  return modal((ctl, owner) => showProfileContent(ctl, owner, appModel));
}

function showProfileContent(ctl: IModalControl, owner: MultiHolder, appModel: AppModel): DomElementArg {
  const apiKey = Observable.create<string>(owner, '');
  const userObs = Observable.create<FullUser|null>(owner, null);
  const isEditingName = Observable.create(owner, false);
  const nameEdit = Observable.create<string>(owner, '');
  const isNameValid = Computed.create(owner, nameEdit, (use, val) => checkName(val));

  let needsReload = false;

  async function fetchApiKey() { apiKey.set(await appModel.api.fetchApiKey()); }
  async function createApiKey() { apiKey.set(await appModel.api.createApiKey()); }
  async function deleteApiKey() { await appModel.api.deleteApiKey(); apiKey.set(''); }
  async function fetchUserProfile() { userObs.set(await appModel.api.getUserProfile()); }

  async function fetchAll() {
    await Promise.all([
      fetchApiKey(),
      fetchUserProfile()
    ]);
  }

  fetchAll().catch(reportError);

  async function updateUserName(val: string) {
    const user = userObs.get();
    if (user && val && val !== user.name) {
      await appModel.api.updateUserName(val);
      await fetchAll();
      needsReload = true;
    }
  }

  owner.onDispose(() => {
    if (needsReload) {
      appModel.topAppModel.initialize();
    }
  });

  return [
    cssModalTitle('User Profile'),
    cssModalWidth('fixed-wide'),
    domComputed(userObs, (user) => user && (
      cssModalBody(
        cssDataRow(cssSubHeader('Email'), user.email),
        cssDataRow(
          cssSubHeader('Name'),
          domComputed(isEditingName, (isediting) => (
            isediting ? [
              transientInput(
                {
                  initialValue: user.name,
                  save: ctl.doWork(async (val) => isNameValid.get() && updateUserName(val)),
                  close: () => { isEditingName.set(false); nameEdit.set(''); },
                },
                dom.on('input', (ev, el) => nameEdit.set(el.value)),
              ),
              cssTextBtn(
                cssBillingIcon('Settings'), 'Save',
                // no need to save on 'click', the transient input already does it on close
              ),
            ] : [
              user.name,
              cssTextBtn(
                cssBillingIcon('Settings'), 'Edit',
                dom.on('click', () => isEditingName.set(true))
              ),
            ]
          )),
          testId('username')
        ),
        // show warning for invalid name but not for the empty string
        dom.maybe(use => use(nameEdit) && !use(isNameValid), cssWarnings),
        cssDataRow(
          cssSubHeader('Login Method'),
          user.loginMethod,
          // TODO: should show btn only when logged in with google
          user.loginMethod === 'Email + Password' ? cssTextBtn(
            // rename to remove mention of Billing in the css
            cssBillingIcon('Settings'), 'Reset',
            dom.on('click', () => confirmPwdResetModal(user.email))
          ) : null,
          testId('login-method'),
        ),
        cssDataRow(cssSubHeader('API Key'), cssContent(
          dom.create(ApiKey, {
            apiKey,
            onCreate: ctl.doWork(createApiKey),
            onDelete: ctl.doWork(deleteApiKey),
            anonymous: false,
          })
        )),
      )
    )),
    cssModalButtons(
      bigPrimaryButton('Close',
        dom.boolAttr('disabled', ctl.workInProgress),
        dom.on('click', () => ctl.close()),
        testId('modal-confirm')
      ),
    ),
  ];
}

// We cannot use the confirmModal here because of the button link that we need here.
function confirmPwdResetModal(userEmail: string) {
  return modal((ctl, owner) => {
    return [
      cssModalTitle('Reset Password'),
      cssModalBody(`Click continue to open the password reset form. Submit it for your email address: ${userEmail}`),
      cssModalButtons(
        bigPrimaryButtonLink(
          { href: getResetPwdUrl(), target: '_blank' },
          'Continue',
          dom.on('click', () => ctl.close())
        ),
        bigBasicButton(
          'Cancel',
          dom.on('click', () => ctl.close())
        ),
      ),
    ];
  });
}


const cssDataRow = styled('div', `
  margin: 8px 0px;
  display: flex;
  align-items: baseline;
`);

const cssSubHeader = styled('div', `
  width: 110px;
  padding: 8px 0;
  display: inline-block;
  vertical-align: top;
  font-weight: bold;
`);

const cssContent = styled('div', `
  flex: 1 1 300px;
`);

const cssTextBtn = styled(billingPageCss.billingTextBtn, `
  width: 90px;
  margin-left: auto;
`);

const cssBillingIcon = billingPageCss.billingIcon;

const cssWarnings = styled(buildNameWarningsDom, `
  margin: -8px 0 0 110px;
`);
