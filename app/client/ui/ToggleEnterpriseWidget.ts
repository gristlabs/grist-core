import {cssSmallLinkButton} from 'app/client/components/Forms/styles';
import {copyToClipboard} from 'app/client/lib/clipboardUtils';
import {makeTestId} from 'app/client/lib/domUtils';
import {dateFmtFull} from 'app/client/lib/formatUtils';
import {makeT} from 'app/client/lib/localization';
import {markdown} from 'app/client/lib/markdown';
import {Notifier} from 'app/client/models/NotifyModel';
import {ToggleEnterpriseModel} from 'app/client/models/ToggleEnterpriseModel';
import {cssOptInButton, cssParagraph, cssSection} from 'app/client/ui/AdminTogglesCss';
import {hoverTooltip, showTransientTooltip} from 'app/client/ui/tooltips';
import {bigPrimaryButton} from 'app/client/ui2018/buttons';
import {colors, theme, vars} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {ActivationState, commonUrls} from 'app/common/gristUrls';
import {not} from 'app/common/gutil';
import {getGristConfig} from 'app/common/urlUtils';
import {BindableValue, Computed, Disposable, dom, input, MultiHolder, Observable, styled} from 'grainjs';

const t = makeT('ToggleEnterprisePage');
const testId = makeTestId('test-toggle-enterprise-');
const TOOLTIP_KEY = 'copy-on-settings';

type State = 'core' | 'activated' | 'trial' | 'no-key' | 'error';

export class ToggleEnterpriseWidget extends Disposable {
  private readonly _model = this.autoDispose(new ToggleEnterpriseModel(this._notifier));
  /** If we are running Enterprise edition (even if not activated or valid) */
  private readonly _isEnterpriseEdition = Computed.create(this, this._model.edition, (_use, edition) => {
    return edition === 'enterprise';
  }).onWrite(async (enabled) => {
    await this._model.updateEnterpriseToggle(enabled ? 'enterprise' : 'core');
  });
  private _activationKey = Observable.create(this, '');
  private _activation = Observable.create<ActivationState | null>(this, null);

  private _state = Computed.create<State | null>(this, use => {
    const status = use(this._model.status);
    if (!use(this._isEnterpriseEdition) || !status) {
      return 'core';
    } else if (status.key) {
      return 'activated';
    } else if (status.trial && status.trial.daysLeft > 0) {
      return 'trial';
    } else if (use(this._activation)?.error) {
      return 'error';
    } else {
      return 'no-key';
    }
  });

  constructor(private _notifier: Notifier) {
    super();
    this._model.fetchEnterpriseToggle().catch(reportError);
    const {activation} = getGristConfig();
    this._activation.set(activation ?? null);
  }

  public getEnterpriseToggleObservable() {
    return this._isEnterpriseEdition;
  }

  public buildEnterpriseSection() {
    return cssSection(
      testId('enterprise-content', this._isEnterpriseEdition),
      dom.domComputed(this._state, state => {
        switch (state) {
          case 'trial':
            return this._trialCopy();
          case 'activated':
            return this._activatedCopy();
          case 'no-key':
            return this._noKeyCopy();
          case 'error':
            return this._errorCopy();
          default:
            return this._coreCopy();
        }
      }),
      testId('enterprise-opt-in-section'),
    );
  }

  private _buildPasteYourKey(show: BindableValue<boolean> = Observable.create(this, true)) {
    const redactedInstallationId = Computed.create(this, this._model.installationId, (use, id) => {
      // Leave only 6 first letter, rest convert to *.
      return id ? id.slice(0, 6) + '*'.repeat(id.length - 6) : '';
    });
    return cssParagraph(
      dom.autoDispose(redactedInstallationId),
      cssTextLine(
        dom('b', t(`Activation key`)),
        cssInstallationId(
          dom('span', t('Installation ID:')),
          dom.text(redactedInstallationId),
          copyHandler(() => this._model.installationId.get()!, t("Installation ID copied to clipboard")),
          testId('installation-id'),
          cssCopyButton(
            icon('Copy'),
          ),
          hoverTooltip(t('Copy to clipboard'), {
            key: TOOLTIP_KEY,
          }),
        ),
      ),
      cssInput(
        this._activationKey, {onInput: true}, {placeholder: t('Paste your activation key')},
        dom.onKeyPress({Enter: this._activateButtonClicked.bind(this)}),
        testId('key-input'),
        dom.boolAttr('disabled', this._model.busy),
      ),
      bigPrimaryButton(
        t('Activate'),
        dom.on('click', this._activateButtonClicked.bind(this)),
        dom.style('margin-top', '12px'),
        testId('activate-button'),
        dom.prop('disabled', use => use(this._activationKey)?.trim().length === 0 || use(this._model.busy)),
      ),
      dom.style('display', 'none'),
      dom.show(show),
    );
  }

  private async _activateButtonClicked() {
    await this._model.activateEnterprise(this._activationKey.get().trim());
  }

  private _trialCopy() {
    return [
      cssParagraph(
        dom('b', t('You are currently trialing Grist Enterprise.')),
      ),
      cssParagraph(
        markdown(t(`An activation key is used to run Grist Enterprise after a trial period
of 30 days has expired. Get an activation key by [contacting us]({{contactLink}}) today. You do
not need an activation key to run Grist Core.

Learn more in our [Help Center]({{helpCenter}}).`, {
            contactLink: commonUrls.contact,
            helpCenter: commonUrls.helpEnterpriseOptIn
        }))
      ),
      this._buildPasteYourKey(),
    ];
  }

  private _activatedCopy() {
    const owner = new MultiHolder();

    const expireAt = Computed.create(owner, use => {
      const state = use(this._model.status);
      if (!state?.key?.expirationDate) {
        return null;
      }
      return dateFmtFull(state.key.expirationDate);
    });

    const expired = Computed.create(owner, use => {
      const state = use(this._model.status);
      return state?.key?.daysLeft !== undefined && state.key.daysLeft <= 0;
    });


    const graceDays = Computed.create(owner, use => {
      const state = use(this._model.status);
      return state?.grace?.daysLeft ?? 0;
    });

    const grace = Computed.create(owner, use => {
      return Boolean(use(graceDays));
    });

    const graceText = Computed.create(owner, use => {
      if (use(grace)) {
        return t('Your instance will be in **read-only** mode in **{{days}}** day(s).', {days: use(graceDays)});
      }
      return '';
    });
    const inputVisible = Observable.create(owner, expired.get());

    const maxSeats = Computed.create(owner, use => {
      const state = use(this._model.status);
      return state?.features?.installationSeats ?? 0;
    });

    const currentSeats = Computed.create(owner, use => {
      const state = use(this._model.status);
      return state?.current?.installationSeats ?? 0;
    });

    const isLimited = Computed.create(owner, use => use(this._model.status)?.features?.installationSeats !== undefined);

    const exceeded = Computed.create(owner, use => {
      return use(isLimited) ? use(currentSeats) > use(maxSeats) : false;
    });


    return [
      cssParagraph(
        testId('key-info'),
        dom.autoDispose(owner),
        cssRow(
          cssLabel(t('Plan name') + ':'),
          dom('div', dom.text('Grist Enterprise')),
          testId('plan-name'),
        ),
        dom.maybe(expireAt, date => [
          cssRow(
            cssLabel(t('Expiration date') + ':'),
            dom('div', dom.text(date), testId('expiration-date')),
          ),
        ]),
        dom.maybe(isLimited, () => [
          cssRow(
            cssLabel(t('Installation seats') + ':'),
            cssFlexLine(testId('installation-seats'), dom.domComputed(use => [
              cssInline(markdown(`Limit: **${use(maxSeats)}**, Current: **${use(currentSeats)}**`)),
              dom.domComputed(exceeded, valid => [
                planStatusIcon(!valid ? 'Tick' : 'CrossSmall', planStatusIcon.cls(!valid ? '-valid' : '-invalid')),
              ])
            ])),
          ),
        ]),
        cssRow(
          cssLabel(t('Activation key') + ':'),
          dom.show(use => !use(inputVisible) || use(expired)),
          cssRowWithEdit(
            dom('span',
              dom('span',
                dom.text(use => use(this._model.status)?.keyPrefix ?? ''),
                testId('key-prefix'),
              ),
              '**********************',
            ),
            cssSmallLinkButton(
              'Update', dom.on('click', () => inputVisible.set(true)),
              testId('update-key-button'),
              dom.show(use => !use(expired) && !use(grace)),
            ),
          ),
        ),
        dom.maybe(use => use(inputVisible) && !use(expired), () => [
          this._buildPasteYourKey(),
        ]),
      ),
      dom.maybe(expired, () => [
        cssSpacer(),
        dom.domComputed(use => [
          cssParagraph(
            dom('b',
              use(exceeded) ? t('Your activation key has expired due to exceeding limits.') :
                t('Your subscription expired on {{date}}.', {date: use(expireAt)})
            ),
            testId('expired-reason'),
          ),
        ]),
      ]),
      dom.maybe(use => use(grace) || use(expired), () => [
        cssSpacer(),
        dom('div',
          testId('expired-info'),
          dom.domComputed(graceText, txt => cssParagraph(
            markdown((txt ? txt + ' ' : '') + t(
              `To continue using Grist Enterprise, you need to
                  [contact us]({{signupLink}}) to get your activation key.`, {
              signupLink: commonUrls.contact,
            })),
          )),
        ),
        cssSpacer(),
        this._buildPasteYourKey(),
      ]),
    ];
  }

  private _coreCopy() {
    return [
      cssParagraph(
        enterpriseNotEnabledCopy()
      ),
      cssOptInButton(t('Enable Grist Enterprise'),
        dom.on('click', () => this._isEnterpriseEdition.set(true)),
      ),
    ];
  }

  private _noKeyCopy() {
    const trialExpired = Computed.create(this, use => {
      const state = use(this._model.status);
      return state?.trial?.expirationDate ? new Date(state.trial.expirationDate) : null;
    });

    const trialExpiredIso = Computed.create(this, use => {
      const date = use(trialExpired);
      return date ? date.toISOString() : '';
    });

    const trialExpiredLocal = Computed.create(this, use => {
      const date = use(trialExpired);
      return date ? dateFmtFull(date) : '';
    });

    return [
      cssParagraph(
        testId('not-active-key'),
        dom('b', t('You do not have an active subscription.'))
      ),
      dom.maybe(trialExpiredLocal, expireAt => [
        cssParagraph(
          markdown(t(
            `Your trial period has expired on **{{expireAt}}**. To continue using Grist Enterprise, you need to
[sign up for Grist Enterprise]({{signupLink}}) and paste your activation key below.`, {
            signupLink: commonUrls.plans,
            expireAt,
          }))
        ),
        dom('span', dom.text(trialExpiredIso), {style: 'display: none;'}, testId('trial-expiration-date')),
      ]),
      dom.maybe(not(trialExpired), () => [
        cssParagraph(
          markdown(t(`An active subscription is required to continue using Grist Enterprise. You can
you activate your subscription by [signing up for Grist Enterprise ]({{signupLink}}) and pasting your
activation key below.`, {
            signupLink: commonUrls.plans,
          }))
        ),
      ]),
      learnMoreLink(),
      this._buildPasteYourKey(),
    ];
  }


  private _errorCopy() {
    return [
      cssParagraph(
        testId('error-message'),
        cssErrorText(dom.text(use => use(this._activation)?.error ?? '')),
      ),
      learnMoreLink(),
      this._buildPasteYourKey(),
    ];
  }
}

function enterpriseNotEnabledCopy() {
  return [
    cssParagraph(
      markdown(t(`An activation key is used to run Grist Enterprise after a trial period
        of 30 days has expired. Get an activation key by [signing up for Grist
        Enterprise]({{signupLink}}). You do not need an activation key to run
        Grist Core.`, {signupLink: commonUrls.plans})),
    ),
    learnMoreLink(),
  ];
}

function learnMoreLink() {
  return cssParagraph(
    markdown(t(`Learn more in our [Help Center]({{helpCenter}}).`, {
      signupLink: commonUrls.plans,
      helpCenter: commonUrls.helpEnterpriseOptIn
    })));
}

function copyHandler(value: () => string, confirmation: string) {
  return dom.on('click', async (e, d) => {
    e.stopImmediatePropagation();
    e.preventDefault();
    showTransientTooltip(d as Element, confirmation, {
      key: TOOLTIP_KEY
    });
    await copyToClipboard(value());
  });
}

export const cssInput = styled(input, `
  color: ${theme.inputFg};
  background-color: ${theme.inputBg};
  font-size: ${vars.mediumFontSize};
  height: 42px;
  line-height: 16px;
  width: 100%;
  padding: 13px;
  border: 1px solid ${theme.inputBorder};
  border-radius: 3px;
  outline: none;

  &-invalid {
    color: ${theme.inputInvalid};
  }

  &[type=number] {
    -moz-appearance: textfield;
  }
  &[type=number]::-webkit-inner-spin-button,
  &[type=number]::-webkit-outer-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }

  &::placeholder {
    color: ${theme.inputPlaceholderFg};
  }
`);

const cssRow = styled('div', `
  display: flex;
  margin-bottom: 8px;
  align-items: baseline;
  flex-wrap: wrap;
  & label {
    margin-right: 8px;
  }
  & div {
    flex-grow: 1;
  }
`);

const cssLabel = styled('label', `
  font-weight: bold;
  margin-right: 8px;
`);

const cssRowWithEdit = styled('div', `
  display: flex;
  justify-content: space-between;
`);


const cssTextLine = styled('div', `
  display: flex;
  align-items: baseline;
  margin-bottom: 8px;
`);

const cssInstallationId = styled('div', `
  margin-left: 16px;
  color: ${theme.inputDisabledFg};
  cursor: pointer;
  display: flex;
  align-items: baseline;
  gap: 4px;
  font-size: ${vars.smallFontSize};
  --icon-color: ${theme.lightText};
  &:hover {
    --icon-color: ${colors.lightGreen};
    background-color: ${theme.lightHover};
  }
`);

const cssSpacer = styled('div', `
  height: 12px;
`);

const cssInline = styled('span', `
  display: inline;
  & p {
    display: inline;
  }
`);

const planStatusIcon = styled(icon, `
  width: 24px;
  height: 24px;

  &-valid {
    --icon-color: ${theme.inputValid};
  }
  &-invalid {
    --icon-color: ${theme.inputInvalid};
  }
`);

const cssFlexLine = styled('span', `
  display: flex;
  align-items: center;
  gap: 4px;
`);

const cssErrorText = styled('div', `
  color: ${theme.errorText};
`);

const cssCopyButton = styled('div', `
  width: 24px;
`);
