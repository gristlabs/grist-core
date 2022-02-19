import {handleSubmit} from 'app/client/lib/formUtils';
import {AppModel} from 'app/client/models/AppModel';
import {reportError, reportSuccess} from 'app/client/models/errors';
import {bigBasicButton, bigPrimaryButton} from 'app/client/ui2018/buttons';
import {colors, vars} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {cssLink} from 'app/client/ui2018/links';
import {loadingSpinner} from 'app/client/ui2018/loaders';
import {cssModalBody, cssModalTitle, cssModalWidth, IModalControl,
        modal, cssModalButtons as modalButtons} from 'app/client/ui2018/modals';
import {ApiError} from 'app/common/ApiError';
import {FullUser} from 'app/common/LoginSessionAPI';
import {AuthMethod, ChallengeRequired, UserMFAPreferences} from 'app/common/UserAPI';
import {Disposable, dom, input, makeTestId, MultiHolder, Observable, styled} from 'grainjs';
import {toDataURL} from 'qrcode';

const testId = makeTestId('test-mfa-');

/**
 * Step in the dialog flow for enabling a MFA method.
 */
type EnableAuthMethodStep =
  | 'verify-password'
  | 'choose-auth-method'
  | 'configure-auth-app'
  | 'configure-phone-message';

/**
 * Step in the dialog flow for disabling a MFA method.
 */
type DisableAuthMethodStep =
  | 'confirm-disable'
  | 'verify-password'
  | 'disable-method';

interface MFAConfigOptions {
  appModel: AppModel;
  // Called when the MFA status is changed successfully.
  onChange: () => void;
}

interface EnablePhoneMessageOptions {
  // Called on successful completion of the enable phone message form.
  onSuccess: (newPhoneNumber: string) => void;
  // If true, shows a back text button on the first screen of the form.
  showBackButton?: boolean;
  // The text to use for the back button if `showBackButton` is true.
  backButtonText?: string;
  // Called when the back button is clicked.
  onBack?: () => void;
}

// Common HTML input options for 6 digit verification fields (SMS and TOTP).
const verificationCodeInputOpts = {
  name: 'verificationCode',
  type: 'text',
  inputmode: 'numeric',
  pattern: '\\d{6}',
  required: 'true',
};

/**
 * Shows information about multi-factor authentication preferences for the logged-in user
 * and buttons for enabling/disabling them.
 *
 * Currently supports software tokens (TOTP) and SMS.
 */
export class MFAConfig extends Disposable {
  private _appModel: AppModel;
  private _user: FullUser;

  constructor(
    private _mfaPrefs: Observable<UserMFAPreferences|null>,
    private _options: MFAConfigOptions
  ) {
    super();
    this._appModel = _options.appModel;
    this._user = this._appModel.currentUser!;
  }

  public buildDom() {
    return this._buildButtons();
  }

  private _buildButtons() {
    return cssButtons(
      dom.domComputed(this._mfaPrefs, mfaPrefs => {
        if (!mfaPrefs) { return cssSmallSpinner(cssSmallLoadingSpinner()); }

        const {isSmsMfaEnabled, isSoftwareTokenMfaEnabled, phoneNumber} = mfaPrefs;
        return [
          !isSmsMfaEnabled && !isSoftwareTokenMfaEnabled ?
            cssTextBtn(
              'Configure two-factor authentication',
              dom.on('click', () => this._showAddAuthMethodModal(undefined, {
                onSuccess: () => {
                  reportSuccess('Two-factor authentication enabled');
                  this._options.onChange();
                }
              })),
              testId('enable-2fa'),
            ) :
            dom.frag(
              cssDataRow(
                cssIconAndText(cssIcon('BarcodeQR'), cssText('Authenticator app')),
                isSoftwareTokenMfaEnabled ?
                  cssTextBtn(
                    'Disable',
                    dom.on('click', () => this._showDisableAuthMethodModal('TOTP', {
                      onSuccess: () => {
                        reportSuccess('Authentication app disabled');
                        this._options.onChange();
                      }
                    })),
                    testId('disable-auth-app'),
                  ) :
                  cssTextBtn(
                    'Enable',
                    dom.on('click', () => this._showAddAuthMethodModal('TOTP', {
                      onSuccess: () => {
                        reportSuccess('Authentication app enabled');
                        this._options.onChange();
                      }
                    })),
                    testId('enable-auth-app'),
                  ),
                testId('auth-app-row')
              ),
              cssDataRow(
                cssIconAndText(
                  cssIcon('MobileChat'),
                  cssText('SMS', isSmsMfaEnabled && phoneNumber ? ` to ${phoneNumber}` : null),
                ),
                isSmsMfaEnabled ?
                  [
                    cssTextBtn(
                      'Change',
                      dom.on('click', () => this._showAddAuthMethodModal('SMS', {
                        onSuccess: () => {
                          reportSuccess('Phone number changed');
                          this._options.onChange();
                        }
                      })),
                      testId('change-phone-number'),
                    ),
                    cssTextBtn(
                      'Disable',
                      dom.on('click', () => this._showDisableAuthMethodModal('SMS', {
                        onSuccess: () => {
                          reportSuccess('Phone message disabled');
                          this._options.onChange();
                        }
                      })),
                      testId('disable-sms'),
                    ),
                  ] :
                  cssTextBtn(
                    'Enable',
                    dom.on('click', () => this._showAddAuthMethodModal('SMS', {
                      onSuccess: () => {
                        reportSuccess('Phone message enabled');
                        this._options.onChange();
                      }
                    })),
                    testId('enable-sms'),
                  ),
                testId('sms-row')
              ),
            ),
        ];
      }),
      testId('buttons')
    );
  }

  /**
   * Displays a modal that allows users to enable a MFA method for their account.
   *
   * @param {AuthMethod | undefined} method If specified, skips the 'choose-auth-method' step.
   * @param {() => void} options.onSuccess Called after successfully adding an auth method.
   */
  private _showAddAuthMethodModal(
    method: AuthMethod | undefined,
    options: {onSuccess: () => void}
  ): void {
    return modal((ctl, owner) => {
      const currentStep = Observable.create<EnableAuthMethodStep>(owner, 'verify-password');

      return [
        dom.domComputed((use) => {
          const step = use(currentStep);
          switch (step) {
            case 'verify-password': {
              return [
                this._buildSecurityVerificationForm(ctl, {onSuccess: async (hadSecondStep) => {
                  /**
                   * If method was unspecified, but second step verification occurred, we know that
                   * the client doesn't have up-to-date 2FA preferences. Close the modal, and force
                   * a refresh of UserMFAPreferences, which should cause the correct buttons to be
                   * rendered once preferences are loaded.
                   *
                   * This is ultimately caused by older Grist sessions (pre-2FA) not having access
                   * or refresh tokens, which makes it impossible to get MFA status without first
                   * requiring that users re-authenticate. Token-less sessions currently return a
                   * disabled status for all 2FA methods as an interim solution, until all old
                   * sessions have expired (3 months).
                   *
                   * TODO: Revisit this 3 months after this commit has landed in prod; we may no longer
                   * need much of these changes.
                   */
                  if (!method && hadSecondStep) {
                    ctl.close();
                    this._options.onChange();
                  }
                  if (!method) { return currentStep.set('choose-auth-method'); }

                  currentStep.set(method === 'SMS' ? 'configure-phone-message' : 'configure-auth-app');
                }}),
              ];
            }
            case 'choose-auth-method': {
              return [
                cssModalTitle('Two-factor authentication', testId('title')),
                cssModalBody(
                  cssMainText(
                    "Once you enable two step authentication, you'll need to enter a special code " +
                    "when you log in. Please choose a method you'd like to receive codes with."
                  ),
                  cssAuthMethods(
                    cssAuthMethod(
                      cssAuthMethodTitle(cssGreenIcon('BarcodeQR2'), 'Authenticator app', testId('auth-method-title')),
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
                      dom.on('click', () => currentStep.set('configure-auth-app')),
                      testId('auth-app-method'),
                    ),
                    cssAuthMethod(
                      cssAuthMethodTitle(cssGreenIcon('MobileChat2'), 'Phone message', testId('auth-method-title')),
                      cssAuthMethodDesc(
                        'You need to add a U.S. phone number where you can receive authentication codes by text.',
                      ),
                      dom.on('click', () => currentStep.set('configure-phone-message')),
                      testId('sms-method'),
                    ),
                  ),
                ),
              ];
            }
            case 'configure-auth-app': {
              return [
                this._buildConfigureAuthAppForm(ctl, {onSuccess: async () => {
                  ctl.close();
                  options.onSuccess();
                }}),
                method ? null: cssBackBtn('← Back to methods',
                  dom.on('click', () => { currentStep.set('choose-auth-method'); }),
                  testId('back-to-methods'),
                ),
              ];
            }
            case 'configure-phone-message': {
              return [
                this._buildConfigurePhoneMessageForm(ctl, {
                  onSuccess: async () => {
                    ctl.close();
                    options.onSuccess();
                  },
                  showBackButton: !method,
                  backButtonText: '← Back to methods',
                  onBack: () => currentStep.set('choose-auth-method'),
                }),
              ];
            }
          }
        }),
        cssModalWidth('fixed-wide'),
      ];
    });
  }

  /**
   * Displays a modal that allows users to disable a MFA method for their account.
   *
   * @param {AuthMethod} method The auth method to disable.
   * @param {() => void} options.onSuccess Called after successfully disabling an auth method.
   */
  private _showDisableAuthMethodModal(method: AuthMethod, options: {onSuccess: () => void}): void {
    return modal((ctl, owner) => {
      const currentStep = Observable.create<DisableAuthMethodStep>(owner, 'confirm-disable');

      return [
        dom.domComputed((use) => {
          const step = use(currentStep);
          switch (step) {
            case 'confirm-disable': {
              return [
                cssModalTitle(
                  `Disable ${method === 'TOTP' ? 'authentication app' : 'phone message'}?`,
                  testId('title')
                ),
                cssModalBody(
                  cssMainText(
                    "Two-factor authentication is an extra layer of security for your Grist account designed " +
                    "to ensure that you're the only person who can access your account, even if someone " +
                    "knows your password."
                  ),
                  cssModalButtons(
                    bigPrimaryButton('Yes, disable',
                      dom.on('click', () => currentStep.set('verify-password')),
                      testId('disable'),
                    ),
                    bigBasicButton('Cancel', dom.on('click', () => ctl.close()), testId('cancel')),
                  ),
                ),
              ];
            }
            case 'verify-password': {
              return [
                this._buildSecurityVerificationForm(ctl, {onSuccess: () => {
                  currentStep.set('disable-method');
                }}),
              ];
            }
            case 'disable-method': {
              const disableMethod = method === 'SMS' ?
                this._unregisterSMS() :
                this._unregisterSoftwareToken();
              disableMethod
              .then(() => { options.onSuccess(); })
              .catch(reportError)
              .finally(() => ctl.close());

              return cssSpinner(loadingSpinner());
            }
          }
        }),
        cssModalWidth('fixed-wide'),
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
  private _buildSecurityVerificationForm(
    ctl: IModalControl,
    {onSuccess}: {onSuccess: (hadSecondStep: boolean) => void}
  ) {
    const holder = new MultiHolder();
    const securityStep = Observable.create<'password' | 'sms' | 'totp' | 'loading'>(holder, 'password');
    const password = Observable.create(holder, '');
    const session = Observable.create(holder, '');
    const challengeDetails = Observable.create<ChallengeRequired | null>(holder, null);

    return [
      dom.autoDispose(holder),
      dom.domComputed(securityStep, (step) => {
        switch (step) {
          case 'loading': {
            return cssSpinner(loadingSpinner());
          }
          case 'password': {
            let formElement: HTMLFormElement;
            const multiHolder = new MultiHolder();
            const pending = Observable.create(multiHolder, false);
            const errorObs: Observable<string|null> = Observable.create(multiHolder, null);

            return dom.frag(
              dom.autoDispose(pending.addListener(isPending => isPending && errorObs.set(null))),
              dom.autoDispose(multiHolder),
              cssModalTitle('Confirm your password', testId('title')),
              cssModalBody(
                formElement = dom('form',
                  cssMainText('Please confirm your password to continue.'),
                  cssBoldSubHeading('Password'),
                  cssInput(password,
                    {onInput: true},
                    {
                      name: 'password',
                      placeholder: 'password',
                      type: 'password',
                      autocomplete: 'current-password',
                      id: 'current-password',
                      required: 'true',
                    },
                    (el) => { setTimeout(() => el.focus(), 10); },
                    dom.onKeyDown({Enter: () => formElement.requestSubmit()}),
                    testId('password-input'),
                  ),
                  cssFormError(dom.text(use => use(errorObs) ?? ''), testId('form-error')),
                  handleSubmit(pending,
                    ({password: pass}) => this._verifyPassword(pass),
                    (result) => {
                      if (!result.isChallengeRequired) { return onSuccess(false); }

                      session.set(result.session);
                      challengeDetails.set(result);
                      if (result.challengeName === 'SMS_MFA') {
                        securityStep.set('sms');
                      } else {
                        securityStep.set('totp');
                      }
                    },
                    (err) => handleFormError(err, errorObs),
                  ),
                  cssModalButtons(
                    bigPrimaryButton('Confirm', dom.boolAttr('disabled', pending), testId('confirm')),
                    bigBasicButton('Cancel', dom.on('click', () => ctl.close()), testId('cancel')),
                  ),
                ),
              ),
            );
          }
          case 'totp': {
            let formElement: HTMLFormElement;
            const multiHolder = new MultiHolder();
            const pending = Observable.create(multiHolder, false);
            const verificationCode = Observable.create(multiHolder, '');
            const errorObs: Observable<string|null> = Observable.create(multiHolder, null);
            const {isAlternateChallengeAvailable, deliveryDestination} = challengeDetails.get()!;

            return dom.frag(
              dom.autoDispose(pending.addListener(isPending => isPending && errorObs.set(null))),
              dom.autoDispose(multiHolder),
              cssModalTitle('Almost there!', testId('title')),
              cssModalBody(
                formElement = dom('form',
                  cssMainText(
                    'Enter the authentication code generated by your app to confirm your account.',
                    testId('main-text'),
                  ),
                  cssBoldSubHeading('Verification Code'),
                  cssCodeInput(verificationCode,
                    {onInput: true},
                    verificationCodeInputOpts,
                    (el) => { setTimeout(() => el.focus(), 10); },
                    dom.onKeyDown({Enter: () => formElement.requestSubmit()}),
                    testId('verification-code-input'),
                  ),
                  cssInput(session, {onInput: true}, {name: 'session', type: 'hidden'}),
                  cssFormError(dom.text(use => use(errorObs) ?? ''), testId('form-error')),
                  handleSubmit(pending,
                    ({verificationCode: code, session: s}) => this._verifySecondStep('TOTP', code, s),
                    () => onSuccess(true),
                    (err) => handleFormError(err, errorObs),
                  ),
                  cssModalButtons(
                    bigPrimaryButton('Submit', dom.boolAttr('disabled', pending), testId('submit')),
                    bigBasicButton('Cancel', dom.on('click', () => ctl.close()), testId('cancel')),
                  ),
                  !isAlternateChallengeAvailable ? null : cssSubText(
                    'Receive a code by SMS? ',
                    cssLink(
                      // Use masked phone from prefs or challenge response, if available.
                      `Text ${deliveryDestination}.`,
                      dom.on('click', async () => {
                        if (pending.get()) { return; }

                        securityStep.set('loading');
                        try {
                          const result = await this._verifyPassword(password.get(), 'SMS');
                          if (result.isChallengeRequired) {
                            session.set(result.session);
                            challengeDetails.set(result);
                            securityStep.set('sms');
                          }
                        } catch (err) {
                          reportError(err as Error|string);
                          securityStep.set('totp');
                        }
                      }),
                    ),
                    testId('use-sms'),
                  ),
                ),
              ),
            );
          }
          case 'sms': {
            let formElement: HTMLFormElement;
            const multiHolder = new MultiHolder();
            const pending = Observable.create(multiHolder, false);
            const verificationCode = Observable.create(multiHolder, '');
            const isResendingCode = Observable.create(multiHolder, false);
            const errorObs: Observable<string|null> = Observable.create(multiHolder, null);
            const resendingListener = isResendingCode.addListener(isResending => {
              if (!isResending) { return; }

              errorObs.set(null);
              verificationCode.set('');
            });
            const {isAlternateChallengeAvailable, deliveryDestination} = challengeDetails.get()!;

            return dom.frag(
              dom.autoDispose(pending.addListener(isPending => isPending && errorObs.set(null))),
              dom.autoDispose(resendingListener),
              dom.autoDispose(multiHolder),
              dom.domComputed(isResendingCode, isLoading => {
                if (isLoading) { return cssSpinner(loadingSpinner()); }

                return [
                  cssModalTitle('Almost there!', testId('title')),
                  cssModalBody(
                    formElement = dom('form',
                      cssMainText(
                        'We have sent an authentication code to ',
                        cssLightlyBoldedText(deliveryDestination),
                        '. Enter it below to confirm your account.',
                        testId('main-text'),
                      ),
                      cssBoldSubHeading('Authentication Code'),
                      cssCodeInput(verificationCode,
                        {onInput: true},
                        {...verificationCodeInputOpts, autocomplete: 'one-time-code'},
                        (el) => { setTimeout(() => el.focus(), 10); },
                        dom.onKeyDown({Enter: () => formElement.requestSubmit()}),
                        testId('verification-code-input'),
                      ),
                      cssInput(session, {onInput: true}, {name: 'session', type: 'hidden'}),
                      cssSubText(
                        "Didn't receive a code? ",
                        cssLink(
                          'Resend it',
                          dom.on('click', async () => {
                            if (pending.get()) { return; }

                            try {
                              isResendingCode.set(true);
                              const result = await this._verifyPassword(password.get(), 'SMS');
                              if (result.isChallengeRequired) {
                                session.set(result.session);
                                challengeDetails.set(result);
                              }
                            } finally {
                              isResendingCode.set(false);
                            }
                          }),
                          testId('resend-code'),
                        ),
                      ),
                      cssFormError(dom.text(use => use(errorObs) ?? ''), testId('form-error')),
                      handleSubmit(pending,
                        ({verificationCode: code, session: s}) => this._verifySecondStep('SMS', code, s),
                        () => onSuccess(true),
                        (err) => handleFormError(err, errorObs),
                      ),
                      cssModalButtons(
                        bigPrimaryButton('Submit', dom.boolAttr('disabled', pending), testId('submit')),
                        bigBasicButton('Cancel', dom.on('click', () => ctl.close()), testId('cancel')),
                      ),
                      !isAlternateChallengeAvailable ? null : cssSubText(
                        cssLink(
                          'Use code from authenticator app?',
                          dom.on('click', async () => {
                            if (pending.get()) { return; }

                            securityStep.set('loading');
                            try {
                              const result = await this._verifyPassword(password.get(), 'TOTP');
                              if (result.isChallengeRequired) {
                                session.set(result.session);
                                securityStep.set('totp');
                              }
                            } catch (err) {
                              reportError(err as Error|string);
                              securityStep.set('sms');
                            }
                          }),
                          testId('use-auth-app'),
                        ),
                      ),
                    )
                  )
                ];
              }),
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
    let formElement: HTMLFormElement;
    const holder = new MultiHolder();
    const qrCode: Observable<string|null> = Observable.create(holder, null);
    const verificationCode = Observable.create(holder, '');
    const pending = Observable.create(holder, false);
    const errorObs: Observable<string|null> = Observable.create(holder, null);

    this._getSoftwareTokenQRCode()
    .then(code => qrCode.isDisposed() || qrCode.set(code))
    .catch(e => { ctl.close(); reportError(e); });

    return [
      dom.autoDispose(pending.addListener(isPending => isPending && errorObs.set(null))),
      dom.autoDispose(holder),
      dom.domComputed(qrCode, code => {
        if (code === null) { return cssSpinner(loadingSpinner()); }

        return [
          cssModalTitle('Configure authenticator app', testId('title')),
          cssModalBody(
            cssModalBody(
              formElement = dom('form',
                cssMainText(
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
                cssBoldSubHeading('To configure your authenticator app:'),
                cssListItem('1. Add a new account'),
                cssListItem('2. Scan the following barcode', {style: 'margin-bottom: 8px'}),
                cssQRCode({src: code}, testId('qr-code')),
                cssListItem('3. Enter the verification code that appears after scanning the barcode'),
                cssBoldSubHeading('Authentication code'),
                cssCodeInput(verificationCode,
                  {onInput: true},
                  verificationCodeInputOpts,
                  dom.onKeyDown({Enter: () => formElement.requestSubmit()}),
                  testId('verification-code-input'),
                ),
                cssFormError(dom.text(use => use(errorObs) ?? ''), testId('form-error')),
                handleSubmit(pending,
                  ({verificationCode: c}) => this._confirmRegisterSoftwareToken(c),
                  () => onSuccess(),
                  (err) => handleFormError(err, errorObs),
                ),
                cssModalButtons(
                  bigPrimaryButton('Verify', dom.boolAttr('disabled', pending), testId('verify')),
                  bigBasicButton('Cancel', dom.on('click', () => ctl.close()), testId('cancel')),
                ),
              ),
            ),
          ),
        ];
      }),
    ];
  }

  /**
   * Builds a form for registering a SMS MFA method.
   *
   * A callback function must be passed, which will be called after successful completion of the
   * registration form.
   *
   * @param {EnablePhoneMessageOptions} options Form options.
   */
  private _buildConfigurePhoneMessageForm(
    ctl: IModalControl,
    {onSuccess, showBackButton, backButtonText, onBack}: EnablePhoneMessageOptions,
  ) {
    const holder = new MultiHolder();
    const configStep = Observable.create<'enter-phone' | 'verify-phone'>(holder, 'enter-phone');
    const pending = Observable.create(holder, false);
    const phoneNumber = Observable.create(holder, '');
    const maskedPhoneNumber = Observable.create(holder, '');

    return [
      dom.autoDispose(holder),
      dom.domComputed(configStep, (step) => {
        switch (step) {
          case 'enter-phone': {
            let formElement: HTMLFormElement;
            const multiHolder = new MultiHolder();
            const errorObs: Observable<string|null> = Observable.create(multiHolder, null);

            return dom.frag(
              dom.autoDispose(pending.addListener(isPending => isPending && errorObs.set(null))),
              dom.autoDispose(multiHolder),
              cssModalTitle('Configure phone message', testId('title')),
              cssModalBody(
                formElement = dom('form',
                  cssMainText(
                    'You need to add a U.S. phone number where you can receive authentication codes by text.',
                  ),
                  cssBoldSubHeading('Phone number'),
                  cssInput(phoneNumber,
                    {onInput: true},
                    {name: 'phoneNumber', placeholder: '+1 (201) 555 0123', type: 'text', required: 'true'},
                    (el) => { setTimeout(() => el.focus(), 10); },
                    dom.onKeyDown({Enter: () => formElement.requestSubmit()}),
                    testId('phone-number-input'),
                  ),
                  cssFormError(dom.text(use => use(errorObs) ?? ''), testId('form-error')),
                  handleSubmit(pending,
                    ({phoneNumber: phone}) => this._registerSMS(phone),
                    ({deliveryDestination}) => {
                      maskedPhoneNumber.set(deliveryDestination);
                      configStep.set('verify-phone');
                    },
                    (err) => handleFormError(err, errorObs),
                  ),
                  cssModalButtons(
                    bigPrimaryButton('Send code', dom.boolAttr('disabled', pending), testId('send-code')),
                    bigBasicButton('Cancel', dom.on('click', () => ctl.close()), testId('cancel')),
                  ),
                ),
              ),
              showBackButton && backButtonText !== undefined && onBack ?
                cssBackBtn(backButtonText, dom.on('click', () => onBack()), testId('back')) :
                null,
            );
          }
          case 'verify-phone': {
            let formElement: HTMLFormElement;
            const multiHolder = new MultiHolder();
            const verificationCode = Observable.create(multiHolder, '');
            const isResendingCode = Observable.create(multiHolder, false);
            const errorObs: Observable<string|null> = Observable.create(multiHolder, null);
            const resendingListener = isResendingCode.addListener(isResending => {
              if (!isResending) { return; }

              errorObs.set(null);
              verificationCode.set('');
            });

            return dom.frag(
              dom.autoDispose(pending.addListener(isPending => isPending && errorObs.set(null))),
              dom.autoDispose(resendingListener),
              dom.autoDispose(multiHolder),
              dom.domComputed(isResendingCode, isLoading => {
                if (isLoading) { return cssSpinner(loadingSpinner()); }

                return [
                  cssModalTitle('Confirm your phone', testId('title')),
                  cssModalBody(
                    formElement = dom('form',
                      cssMainText(
                        'We have sent the authentication code to ',
                        cssLightlyBoldedText(maskedPhoneNumber.get()),
                        '. Enter it below to confirm your account.',
                        testId('main-text'),
                      ),
                      cssBoldSubHeading('Authentication Code'),
                      cssCodeInput(verificationCode,
                        {onInput: true},
                        {...verificationCodeInputOpts, autocomplete: 'one-time-code'},
                        (el) => { setTimeout(() => el.focus(), 10); },
                        dom.onKeyDown({Enter: () => formElement.requestSubmit()}),
                        testId('verification-code-input'),
                      ),
                      cssSubText(
                        "Didn't receive a code? ",
                        cssLink(
                          'Resend it',
                          dom.on('click', async () => {
                            if (pending.get()) { return; }

                            try {
                              isResendingCode.set(true);
                              await this._registerSMS(phoneNumber.get());
                            } finally {
                              isResendingCode.set(false);
                            }
                          }),
                          testId('resend-code'),
                        ),
                      ),
                      cssFormError(dom.text(use => use(errorObs) ?? ''), testId('form-error')),
                      handleSubmit(pending,
                        ({verificationCode: code}) => this._confirmRegisterSMS(code),
                        () => onSuccess(maskedPhoneNumber.get()),
                        (err) => handleFormError(err, errorObs),
                      ),
                      cssModalButtons(
                        bigPrimaryButton('Confirm', dom.boolAttr('disabled', pending), testId('confirm')),
                        bigBasicButton('Cancel', dom.on('click', () => ctl.close()), testId('cancel')),
                      ),
                    )
                  ),
                  cssBackBtn('← Back to phone number',
                    dom.on('click', () => configStep.set('enter-phone')),
                    testId('back-to-phone')
                  ),
                ];
              })
            );
          }
        }
      }),
    ];
  }

  private async _registerSoftwareToken() {
    return await this._appModel.api.registerSoftwareToken();
  }

  private async _confirmRegisterSoftwareToken(verificationCode: string) {
    await this._appModel.api.confirmRegisterSoftwareToken(verificationCode);
  }

  private async _unregisterSoftwareToken() {
    await this._appModel.api.unregisterSoftwareToken();
  }

  private async _registerSMS(phoneNumber: string) {
    return await this._appModel.api.registerSMS(phoneNumber);
  }

  private async _confirmRegisterSMS(verificationCode: string) {
    await this._appModel.api.confirmRegisterSMS(verificationCode);
  }

  private async _unregisterSMS() {
    await this._appModel.api.unregisterSMS();
  }

  private async _verifyPassword(password: string, preferredMfaMethod?: AuthMethod) {
    return await this._appModel.api.verifyPassword(password, preferredMfaMethod);
  }

  private async _verifySecondStep(authMethod: AuthMethod, verificationCode: string, session: string) {
    await this._appModel.api.verifySecondStep(authMethod, verificationCode, session);
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
 * Sets the error details on `errObs` if `err` is a 4XX error (except 401). Otherwise, reports the
 * error via the Notifier instance.
 */
function handleFormError(err: unknown, errObs: Observable<string|null>) {
  if (
    err instanceof ApiError &&
    err.status !== 401 &&
    err.status >= 400 &&
    err.status < 500
  ) {
    errObs.set(err.details?.userError ?? err.message);
  } else {
    reportError(err as Error|string);
  }
}

const spinnerSizePixels = '24px';

const cssButtons = styled('div', `
  min-height: ${spinnerSizePixels};
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

const cssMainText = styled(cssText, `
  margin-bottom: 32px;
`);

const cssListItem = styled(cssText, `
  margin-bottom: 16px;
`);

const cssSubText = styled(cssText, `
  margin-top: 16px;
`);

const cssFormError = styled('div', `
  color: red;
  min-height: 20px;
  margin-top: 16px;
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

const cssBackBtn = styled(cssTextBtn, `
  margin-top: 16px;
`);

const cssAuthMethods = styled('div', `
  display: grid;
  grid-auto-rows: 1fr;
  margin-top: 16px;
  gap: 8px;
`);

const cssAuthMethod = styled('div', `
  border: 1px solid ${colors.mediumGreyOpaque};
  border-radius: 3px;
  cursor: pointer;

  &:hover {
    border: 1px solid ${colors.slate};
  }
`);

const cssAuthMethodTitle = styled(cssIconAndText, `
  font-size: ${vars.mediumFontSize};
  font-weight: bold;
  color: ${colors.lightGreen};
  margin: 16px 16px 8px 16px;
`);

const cssAuthMethodDesc = styled('div', `
  color: #8a8a8a;
  padding: 0px 16px 16px 40px;
`);

const cssInput = styled(input, `
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

const cssSmallLoadingSpinner = styled(loadingSpinner, `
  width: ${spinnerSizePixels};
  height: ${spinnerSizePixels};
  border-radius: ${spinnerSizePixels};
`);

const cssCenteredDiv = styled('div', `
  display: flex;
  justify-content: center;
  align-items: center;
`);

const cssSmallSpinner = cssCenteredDiv;

const cssSpinner = styled(cssCenteredDiv, `
  height: 200px;
  min-width: 200px;
`);

const cssBoldSubHeading = styled('div', `
  font-weight: bold;
  margin-bottom: 16px;
`);

const cssLightlyBoldedText = styled('span', `
  font-weight: 500;
`);

const cssQRCode = styled('img', `
  width: 140px;
  height: 140px;
  margin-bottom: 16px;
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
