import {submitForm} from 'app/client/lib/uploads';
import {AppModel} from 'app/client/models/AppModel';
import {reportError, reportSuccess} from 'app/client/models/errors';
import {getMainOrgUrl} from 'app/client/models/gristUrlState';
import {bigBasicButton, bigPrimaryButton} from 'app/client/ui2018/buttons';
import {colors, vars} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {cssLink} from 'app/client/ui2018/links';
import {loadingSpinner} from 'app/client/ui2018/loaders';
import {cssModalBody, cssModalTitle, IModalControl, modal,
        cssModalButtons as modalButtons} from 'app/client/ui2018/modals';
import {ApiError} from 'app/common/ApiError';
import {FullUser} from 'app/common/LoginSessionAPI';
import {UserMFAPreferences} from 'app/common/UserAPI';
import {Disposable, dom, input, makeTestId, Observable, styled} from 'grainjs';
import {toDataURL} from 'qrcode';

const testId = makeTestId('test-mfa-');

type AuthMethod =
  | 'SOFTWARE_TOKEN';

/**
 * Step in the dialog flow for enabling a MFA method.
 */
type EnableAuthMethodStep =
  | 'verify-password'
  | 'choose-auth-method'
  | 'configure-auth-app';

/**
 * Step in the dialog flow for disabling a MFA method.
 */
type DisableAuthMethodStep =
  | 'confirm-disable'
  | 'verify-password'
  | 'disable-method';

interface MFAConfigOptions {
  appModel: AppModel;
  user: FullUser;
}

/**
 * Shows information about multi-factor authentication preferences for the logged-in user
 * and buttons for enabling/disabling them.
 *
 * Currently supports software tokens only.
 */
export class MFAConfig extends Disposable {
  private _appModel: AppModel;
  private _user: FullUser;

  constructor(
    private _mfaPrefs: Observable<UserMFAPreferences|null>,
    options: MFAConfigOptions
  ) {
    super();
    this._appModel = options.appModel;
    this._user = options.user;
  }

  public buildDom() {
    return this._buildButtons();
  }

  private _buildButtons() {
    return dom.maybe(this._mfaPrefs, mfaPrefs => {
      const {isSmsMfaEnabled, isSoftwareTokenMfaEnabled} = mfaPrefs;

      return cssContainer(
        !isSmsMfaEnabled && !isSoftwareTokenMfaEnabled ?
          cssTextBtn(
            'Enable two-factor authentication',
            dom.on('click', () => this._showAddAuthMethodModal()),
            testId('enable-2fa'),
          ) :
          dom.frag(
            isSoftwareTokenMfaEnabled ?
              cssDataRow(
                cssIconAndText(cssIcon('BarcodeQR'), cssText('Authenticator app')),
                cssTextBtn(
                  'Disable',
                  dom.on('click', () => this._showDisableAuthMethodModal('SOFTWARE_TOKEN')),
                  testId('disable-auth-app'),
                )
              ) :
              cssTextBtn(
                'Add an authenticator app',
                dom.on('click', () => this._showAddAuthMethodModal('SOFTWARE_TOKEN')),
                testId('add-auth-app'),
              ),
          ),
        testId('container'),
      );
    });
  }

  /**
   * Displays a modal that allows users to enable a MFA method for their account.
   *
   * @param {AuthMethod} method If specified, skips the 'choose-auth-method' step.
   */
  private _showAddAuthMethodModal(method?: AuthMethod): void {
    return modal((ctl, owner) => {
      const selectedAuthMethod = Observable.create(owner, method ?? null);
      const currentStep = Observable.create<EnableAuthMethodStep>(owner, 'verify-password');

      return [
        dom.domComputed((use) => {
          const step = use(currentStep);
          switch (step) {
            case 'verify-password': {
              return [
                this._buildSecurityVerificationForm({onSuccess: async () => {
                  currentStep.set('choose-auth-method');
                }}),
                cssTextBtn('← Back', dom.on('click', () => { ctl.close(); })),
              ];
            }
            case 'choose-auth-method': {
              return [
                cssModalTitle('Two-factor authentication'),
                cssModalBody(
                  cssText(
                    "Once you enable two step verification, you'll need to enter a special code " +
                    "when you log in. Please choose a method you'd like to receive codes with."
                  ),
                  cssAuthMethods(
                    cssAuthMethod(
                      cssAuthMethodTitle(cssGreenIcon('BarcodeQR2'), 'Authenticator App'),
                      cssAuthMethodDesc(
                        "An authenticator app lets you access your security code without receiving a call " +
                        "or text message. If you don't already have an authenticator app, we'd recommend " +
                        "using ",
                        cssLink('Google Authenticator', dom.on('click', e => e.stopPropagation()), {
                          href: 'https://play.google.com/store/apps/' +
                            'details?id=com.google.android.apps.authenticator2&hl=en_US&gl=US',
                          target: '_blank',
                        }),
                        ".",
                      ),
                      dom.on('click', () => {
                        selectedAuthMethod.set('SOFTWARE_TOKEN');
                        currentStep.set('configure-auth-app');
                      }),
                    ),
                  )
                ),
              ];
            }
            case 'configure-auth-app': {
              return [
                this._buildConfigureAuthAppForm(ctl, {onSuccess: async () => {
                  ctl.close();
                  reportSuccess('Two-factor authentication enabled');
                  this._mfaPrefs.set({...this._mfaPrefs.get()!, isSoftwareTokenMfaEnabled: true});
                }}),
                cssTextBtn('← Back to methods', dom.on('click', () => { currentStep.set('choose-auth-method'); })),
              ];
            }
          }
        }),
        cssModal.cls(''),
      ];
    });
  }

  /**
   * Displays a modal that allows users to disable a MFA method for their account.
   *
   * @param {AuthMethod} method The auth method to disable. Currently unused, until additional methods are added.
   */
  private _showDisableAuthMethodModal(method: AuthMethod): void {
    return modal((ctl, owner) => {
      const currentStep = Observable.create<DisableAuthMethodStep>(owner, 'confirm-disable');

      return [
        dom.domComputed((use) => {
          const step = use(currentStep);
          switch (step) {
            case 'confirm-disable': {
              return [
                cssModalTitle('Disable authenticator app?'),
                cssModalBody(
                  cssText(
                    "Two-factor authentication is an extra layer of security for your Grist account designed " +
                    "to ensure that you're the only person who can access your account, even if someone " +
                    "knows your password."
                  ),
                  cssModalButtons(
                    bigPrimaryButton('Confirm', dom.on('click', () => { currentStep.set('verify-password'); })),
                    bigBasicButton('Cancel', dom.on('click', () => ctl.close())),
                  ),
                ),
              ];
            }
            case 'verify-password': {
              return [
                this._buildSecurityVerificationForm({onSuccess: () => currentStep.set('disable-method')}),
                cssTextBtn('← Back', dom.on('click', () => { currentStep.set('confirm-disable'); })),
              ];
            }
            case 'disable-method': {
              this._unregisterSoftwareToken()
                .then(() => {
                  reportSuccess('Authenticator app disabled');
                  this._mfaPrefs.set({...this._mfaPrefs.get()!, isSoftwareTokenMfaEnabled: false});
                })
                .catch(reportError)
                .finally(() => ctl.close());

              return cssLoadingSpinner(loadingSpinner());
            }
          }
        }),
        cssModal.cls(''),
      ];
    });
  }

  /**
   * Builds security verification forms, including a password form and optional 2FA verification form.
   *
   * A callback function must be passed, which will be called after successful completion of the
   * verification forms.
   *
   * @param {() => void} options.onSuccess Called after successful completion of verification.
   */
  private _buildSecurityVerificationForm({onSuccess}: {onSuccess: () => void}) {
    const securityStep = Observable.create<'password' | 'verification-code'>(null, 'password');
    const pending = Observable.create(null, false);
    const session = Observable.create(null, '');

    return [
      dom.autoDispose(securityStep),
      dom.autoDispose(session),
      dom.autoDispose(pending),
      dom.domComputed(securityStep, (step) => {
        switch (step) {
          case 'password': {
            const verifyPasswordUrl = getMainOrgUrl() + 'api/auth/verify_pass';
            const password = Observable.create(null, '');
            let passwordElement: HTMLInputElement;
            setTimeout(() => passwordElement.focus(), 10);

            const error: Observable<string|null> = Observable.create(null, null);
            const errorListener = pending.addListener(isPending => isPending && error.set(null));

            return dom.frag(
              dom.autoDispose(password),
              dom.autoDispose(error),
              dom.autoDispose(errorListener),
              cssModalTitle('Confirm your password'),
              cssModalBody(
                dom('form',
                  {method: 'post', action: verifyPasswordUrl},
                  handleSubmit(pending,
                    (result) => {
                      if (!result.isChallengeRequired) { return onSuccess(); }

                      session.set(result.session);
                      securityStep.set('verification-code');
                    },
                    (err) => {
                      if (isUserError(err)) {
                        error.set(err.details?.userError ?? err.message);
                      } else {
                        reportError(err as Error|string);
                      }
                    },
                  ),
                  cssConfirmText('Please confirm your password to continue.'),
                  cssBoldSubHeading('Password'),
                  passwordElement = cssInput(password,
                    {onInput: true},
                    {name: 'password', placeholder: 'password', type: 'password'},
                  ),
                  cssFormError(dom.text(use => use(error) ?? '')),
                  cssModalButtons(
                    bigPrimaryButton('Confirm',
                      dom.boolAttr('disabled', use => use(pending) || use(password).trim().length === 0),
                    ),
                  ),
                ),
              ),
            );
          }
          case 'verification-code': {
            const verifyAuthCodeUrl = getMainOrgUrl() + 'api/auth/verify_totp';
            const authCode = Observable.create(null, '');

            const error: Observable<string|null> = Observable.create(null, null);
            const errorListener = pending.addListener(isPending => isPending && error.set(null));

            return dom.frag(
              dom.autoDispose(authCode),
              dom.autoDispose(error),
              dom.autoDispose(errorListener),
              cssModalTitle('Almost there!'),
              cssModalBody(
                dom('form',
                  {method: 'post', action: verifyAuthCodeUrl},
                  handleSubmit(pending,
                    () => onSuccess(),
                    (err) => {
                      if (isUserError(err)) {
                        error.set(err.details?.userError ?? err.message);
                      } else {
                        reportError(err as Error|string);
                      }
                    },
                  ),
                  cssConfirmText('Enter the authentication code generated by your app to confirm your account.'),
                  cssBoldSubHeading('Verification Code '),
                  cssCodeInput(authCode, {onInput: true}, {name: 'verificationCode', type: 'number'}),
                  cssFormError(dom.text(use => use(error) ?? '')),
                  cssInput(session, {onInput: true}, {name: 'session', type: 'hidden'}),
                  cssModalButtons(
                    bigPrimaryButton('Submit',
                      dom.boolAttr('disabled', use => use(pending) || use(authCode).trim().length !== 6),
                    ),
                  ),
                ),
              ),
            );
          }
        }
      }),
    ];
  }

  /**
   * Builds a form for registering a software token (TOTP) MFA method.
   *
   * A callback function must be passed, which will be called after successful completion of the
   * registration form.
   *
   * @param {() => void} options.onSuccess Called after successful completion of registration.
   */
  private _buildConfigureAuthAppForm(ctl: IModalControl, {onSuccess}: {onSuccess: () => void}) {
    const confirmCodeUrl = getMainOrgUrl() + 'api/auth/confirm_totp_registration';
    const qrCode: Observable<string|null> = Observable.create(null, null);
    const verificationCode = Observable.create(null, '');
    const pending = Observable.create(null, false);

    const error: Observable<string|null> = Observable.create(null, null);
    const errorListener = pending.addListener(isPending => isPending && error.set(null));

    this._getSoftwareTokenQRCode()
      .then(code => qrCode.isDisposed() || qrCode.set(code))
      .catch(e => { ctl.close(); reportError(e); });

    return [
      dom.autoDispose(qrCode),
      dom.autoDispose(verificationCode),
      dom.autoDispose(pending),
      dom.autoDispose(error),
      dom.autoDispose(errorListener),
      dom.domComputed(qrCode, code => {
        if (code === null) { return cssLoadingSpinner(loadingSpinner()); }

        return [
          cssModalTitle('Configure authenticator app'),
          cssModalBody(
            cssModalBody(
              cssConfigureAuthAppDesc(
                "An authenticator app lets you access your security code without receiving a call " +
                "or text message. If you don't already have an authenticator app, we'd recommend " +
                "using ",
                cssLink('Google Authenticator', {
                  href: 'https://play.google.com/store/apps/' +
                    'details?id=com.google.android.apps.authenticator2&hl=en_US&gl=US',
                  target: '_blank',
                }),
                ".",
              ),
              cssConfigureAuthAppSubHeading('To configure your authenticator app:'),
              cssConfigureAuthAppStep('1. Add a new account'),
              cssConfigureAuthAppStep('2. Scan the following QR code', {style: 'margin-bottom: 0px'}),
              cssQRCode({src: code}),
              cssConfigureAuthAppStep('3. Enter the verification code that appears after scanning the QR code'),
              dom('form',
                {method: 'post', action: confirmCodeUrl},
                handleSubmit(pending,
                  () => onSuccess(),
                  (err) => {
                    if (isUserError(err)) {
                      error.set(err.details?.userError ?? err.message);
                    } else {
                      reportError(err as Error|string);
                    }
                  },
                  ),
                cssBoldSubHeading('Authentication code'),
                cssCodeInput(verificationCode, {onInput: true}, {name: 'userCode', type: 'number'}),
                cssFormError(dom.text(use => use(error) ?? '')),
                cssModalButtons(
                  bigPrimaryButton('Verify',
                    dom.boolAttr('disabled', use => use(pending) || use(verificationCode).trim().length !== 6),
                  ),
                  bigBasicButton('Cancel', dom.on('click', () => ctl.close())),
                ),
              ),
            ),
          ),
        ];
      }),
    ];
  }

  private async _registerSoftwareToken() {
    return await this._appModel.api.registerSoftwareToken();
  }

  private async _unregisterSoftwareToken() {
    return await this._appModel.api.unregisterSoftwareToken();
  }

  /**
   * Returns a data URL for a QR code that encodes a software token (TOTP) MFA shared secret. The
   * URL can be set on an HTML image tag to display an image of the QR code in the browser.
   *
   * Used by _buildConfigureAuthAppForm to build the TOTP registration form.
   */
  private async _getSoftwareTokenQRCode() {
    const {secretCode} = await this._registerSoftwareToken();
    const qrCodeUrl = `otpauth://totp/${encodeURI(`Grist:${this._user.email}`)}?secret=${secretCode}&issuer=Grist`;
    const qrCode = await toDataURL(qrCodeUrl);
    return qrCode;
  }
}

/**
 * Helper function that handles form submissions. Sets `pending` to true after
 * submitting, and resets it to false after submission completes.
 *
 * Callback functions `onSuccess` and `onError` handle post-submission logic.
 */
function handleSubmit(pending: Observable<boolean>,
  onSuccess: (v: any) => void,
  onError?: (e: unknown) => void
): (elem: HTMLFormElement) => void {
  return dom.on('submit', async (e, form) => {
    e.preventDefault();
    await submit(form, pending, onSuccess, onError);
  });
}

/**
 * Submits an HTML form, and forwards responses and errors to `onSuccess` and `onError` respectively.
 */
async function submit(form: HTMLFormElement, pending: Observable<boolean>,
  onSuccess: (v: any) => void,
  onError: (e: unknown) => void = (e) => reportError(e as string|Error)
) {
  try {
    if (pending.get()) { return; }
    pending.set(true);
    const result = await submitForm(form).finally(() => pending.set(false));
    onSuccess(result);
  } catch (err) {
    onError(err);
  }
}

/**
 * Returns true if `error` is an API error with a 4XX status code.
 *
 * Used to determine which errors should be shown in-line in forms.
 */
function isUserError(error: unknown): error is ApiError {
  if (!(error instanceof ApiError)) { return false; }

  return error.status >= 400 && error.status < 500;
}

const cssContainer = styled('div', `
  position: relative;
  display: flex;
  flex-direction: column;
  margin: 8px 0px;
`);

const cssDataRow = styled('div', `
  margin-top: 8px;
  display: flex;
  gap: 16px;
`);

const cssText = styled('div', `
  font-size: ${vars.mediumFontSize};
  border: none;
  padding: 0;
  text-align: left;
`);

const cssConfirmText = styled(cssText, `
  margin-bottom: 32px;
`);

const cssFormError = styled('div', `
  color: red;
  min-height: 20px;
  margin-top: 16px;
`);

const cssConfigureAuthAppDesc = styled(cssText, `
  margin-bottom: 32px;
`);

const cssIconAndText = styled('div', `
  display: flex;
  align-items: center;
  gap: 8px;
`);

const cssTextBtn = styled('button', `
  font-size: ${vars.mediumFontSize};
  color: ${colors.lightGreen};
  cursor: pointer;
  background-color: transparent;
  border: none;
  padding: 0;
  text-align: left;

  &:hover {
    color: ${colors.darkGreen};
  }
`);

const cssAuthMethods = styled('div', `
  display: flex;
  flex-direction: column;
  margin-top: 16px;
  gap: 8px;
`);

const cssAuthMethod = styled('div', `
  border: 1px solid ${colors.mediumGreyOpaque};
  cursor: pointer;

  &:hover {
    border: 1px solid ${colors.slate};
  }
`);

const cssAuthMethodTitle = styled(cssIconAndText, `
  font-size: ${vars.mediumFontSize};
  font-weight: bold;
  color: ${colors.lightGreen};
  margin: 16px;
`);

const cssAuthMethodDesc = styled('div', `
  color: #8a8a8a;
  padding-left: 28px;
  margin: 16px;
`);

const cssInput = styled(input, `
  margin-top: 16px;
  font-size: ${vars.mediumFontSize};
  height: 42px;
  line-height: 16px;
  width: 100%;
  padding: 13px;
  border: 1px solid #D9D9D9;
  border-radius: 3px;
  outline: none;

  &[type=number] {
    -moz-appearance: textfield;
  }
  &[type=number]::-webkit-inner-spin-button,
  &[type=number]::-webkit-outer-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }
`);

const cssCodeInput = styled(cssInput, `
  width: 200px;
`);

const cssModal = styled('div', `
  width: 600px;
`);

const cssLoadingSpinner = styled('div', `
  height: 200px;
  display: flex;
  justify-content: center;
  align-items: center;
`);

const cssBoldSubHeading = styled('div', `
  font-weight: bold;
`);

const cssConfigureAuthAppSubHeading = styled(cssBoldSubHeading, `
  margin-bottom: 16px;
`);

const cssConfigureAuthAppStep = styled(cssText, `
  margin-bottom: 16px;
`);

const cssQRCode = styled('img', `
  width: 140px;
  height: 140px;
`);

const cssIcon = styled(icon, `
  width: 16px;
  height: 16px;
`);

const cssGreenIcon = styled(cssIcon, `
  background-color: ${colors.lightGreen};
`);

const cssModalButtons = styled(modalButtons, `
  margin: 16px 0 0 0;
`);
