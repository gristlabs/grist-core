import { Computed, Disposable, dom, domComputed, DomContents, input, MultiHolder, Observable, styled } from "grainjs";

import { submitForm } from "app/client/lib/uploads";
import { AppModel, reportError } from "app/client/models/AppModel";
import { getLoginUrl, getSignupUrl, urlState } from "app/client/models/gristUrlState";
import { AccountWidget } from "app/client/ui/AccountWidget";
import { appHeader } from 'app/client/ui/AppHeader';
import * as BillingPageCss from "app/client/ui/BillingPageCss";
import * as forms from "app/client/ui/forms";
import { pagePanels } from "app/client/ui/PagePanels";
import { bigBasicButton, bigBasicButtonLink, bigPrimaryButton, bigPrimaryButtonLink,
         cssButton } from "app/client/ui2018/buttons";
import { colors, mediaSmall, testId, vars } from "app/client/ui2018/cssVars";
import { getOrgName, Organization } from "app/common/UserAPI";

// Redirect from ..../welcome/thing to .../welcome/${name}
function _redirectToSiblingPage(name: string) {
  const url = new URL(location.href);
  const parts = url.pathname.split('/');
  parts.pop();
  parts.push(name);
  url.pathname = parts.join('/');
  window.location.assign(url.href);
}

// Redirect to result.redirectUrl is set, otherwise fail
function _redirectOnSuccess(result: any) {
  const redirectUrl = result.redirectUrl;
  if (!redirectUrl) {
    throw new Error('form failed to redirect');
  }
  window.location.assign(redirectUrl);
}


async function _submitForm(form: HTMLFormElement, pending: Observable<boolean>,
                           onSuccess: (v: any) => void = _redirectOnSuccess,
                           onError: (e: Error) => void = reportError) {
  try {
    if (pending.get()) { return; }
    pending.set(true);
    const result = await submitForm(form).finally(() => pending.set(false));
    onSuccess(result);
  } catch (err) {
    onError(err?.details?.userError || err);
  }
}

// If a 'pending' observable is given, it will be set to true while waiting for the submission.
function handleSubmit(pending: Observable<boolean>,
                      onSuccess?: (v: any) => void,
                      onError?: (e: Error) => void): (elem: HTMLFormElement) => void {
  return dom.on('submit', async (e, form) => {
    e.preventDefault();
    // TODO: catch isn't needed, so either remove or propagate errors from _submitForm.
    _submitForm(form, pending, onSuccess, onError).catch(reportError);
  });
}

export class WelcomePage extends Disposable {

  private _currentUserName = this._appModel.currentUser && this._appModel.currentUser.name || '';
  private _orgs: Organization[];
  private _orgsLoaded = Observable.create(this, false);

  constructor(private _appModel: AppModel) {
    super();
  }

  public buildDom() {
    return pagePanels({
      leftPanel: {
        panelWidth: Observable.create(this, 240),
        panelOpen: Observable.create(this, false),
        hideOpener: true,
        header: appHeader('', this._appModel.topAppModel.productFlavor),
        content: null,
      },
      headerMain: [cssFlexSpace(), dom.create(AccountWidget, this._appModel)],
      contentMain: this.buildPageContent()
    });
  }

  public buildPageContent(): Element {
    return cssScrollContainer(cssContainer(
      cssTitle('Welcome to Grist'),
      testId('welcome-page'),

      domComputed(urlState().state, (state) => (
        state.welcome === 'signup' ? dom.create(this._buildSignupForm.bind(this)) :
        state.welcome === 'verify' ? dom.create(this._buildVerifyForm.bind(this)) :
        state.welcome === 'user' ? dom.create(this._buildNameForm.bind(this)) :
        state.welcome === 'info' ? dom.create(this._buildInfoForm.bind(this)) :
        state.welcome === 'teams' ? dom.create(this._buildOrgPicker.bind(this)) :
        null
      )),
    ));
  }

  private _buildNameForm(owner: MultiHolder) {
    let inputEl: HTMLInputElement;
    let form: HTMLFormElement;
    const value = Observable.create(owner, checkName(this._currentUserName) ? this._currentUserName : '');
    const isNameValid = Computed.create(owner, value, (use, val) => checkName(val));
    const pending = Observable.create(owner, false);

    // delayed focus
    setTimeout(() => inputEl.focus(), 10);

    return form = dom(
      'form',
      { method: "post", action: location.href },
      handleSubmit(pending),
      cssLabel('Your full name, as you\'d like it displayed to your collaborators.'),
      inputEl = cssInput(
        value, { onInput: true, },
        { name: "username" },
        // TODO: catch isn't needed, so either remove or propagate errors from _submitForm.
        dom.onKeyDown({Enter: () => isNameValid.get() && _submitForm(form, pending).catch(reportError)}),
      ),
      dom.maybe((use) => use(value) && !use(isNameValid), buildNameWarningsDom),
      cssButtonGroup(
        bigPrimaryButton(
          'Continue',
          dom.boolAttr('disabled', (use) => Boolean(use(value) && !use(isNameValid)) || use(pending)),
          testId('continue-button')
        ),
      )
    );
  }

  private _buildSignupForm(owner: MultiHolder) {
    let inputEl: HTMLInputElement;
    const pending = Observable.create(owner, false);

    // delayed focus
    setTimeout(() => inputEl.focus(), 10);

    // We expect to have an email query parameter on welcome/signup.
    // TODO: make form work without email parameter - except the real todo is:
    // TODO: replace this form with Amplify.
    const url = new URL(location.href);
    const email = Observable.create(owner, url.searchParams.get('email') || '');
    const password = Observable.create(owner, '');

    const action = new URL(window.location.href);
    action.pathname = '/signup/register';

    return dom(
      'form',
      { method: "post", action: action.href },
      handleSubmit(pending, () => _redirectToSiblingPage('verify')),
      dom('p',
          `Welcome Sumo-ling! ` +  // This flow currently only used with AppSumo.
          `Your Grist site is almost ready. Let's get your account set up and verified. ` +
          `If you already have a Grist account as `,
          dom('b', email.get()),
          ` you can just `,
          dom('a', {href: getLoginUrl(urlState().makeUrl({}))}, 'log in'),
          ` now. Otherwise, please pick a password.`
         ),
      cssSeparatedLabel('The email address you activated Grist with:'),
      cssInput(
        email, { onInput: true, },
        { name: "emailShow" },
        dom.boolAttr('disabled', true),
        dom.attr('type', 'email'),
      ),
      // Duplicate email as a hidden form since disabled input won't get submitted
      // for some reason.
      cssInput(
        email, { onInput: true, },
        { name: "email" },
        dom.boolAttr('hidden', true),
        dom.attr('type', 'email'),
      ),
      cssSeparatedLabel('A password to use with Grist:'),
      inputEl = cssInput(
        password, { onInput: true, },
        { name: "password" },
        dom.attr('type', 'password'),
      ),
      cssButtonGroup(
        bigPrimaryButton(
          'Continue',
          testId('continue-button')
        ),
        bigBasicButtonLink('Did this already', dom.on('click', () => {
          _redirectToSiblingPage('verify');
        }))
      ),
    );
  }

  private _buildVerifyForm(owner: MultiHolder) {
    let inputEl: HTMLInputElement;
    const pending = Observable.create(owner, false);

    // delayed focus
    setTimeout(() => inputEl.focus(), 10);

    const action = new URL(window.location.href);
    action.pathname = '/signup/verify';

    const url = new URL(location.href);
    const email = Observable.create(owner, url.searchParams.get('email') || '');
    const code = Observable.create(owner, url.searchParams.get('code') || '');
    return dom(
      'form',
      { method: "post", action: action.href },
      handleSubmit(pending, (result) => {
        if (result.act === 'confirmed') {
          const verified = new URL(window.location.href);
          verified.pathname = '/verified';
          window.location.assign(verified.href);
        } else if (result.act === 'resent') {
          // just to give a sense that something happened...
          window.location.reload();
        }
      }),
      dom('p',
          `Please check your email for a 6-digit verification code, and enter it here.`),
      dom('p',
          `If you've any trouble, try our full set of sign-up options. Do take care to use ` +
          `the email address you activated with: `,
          dom('b', email.get())),
      cssSeparatedLabel('Confirmation code'),
      inputEl = cssInput(
        code, { onInput: true, },
        { name: "code" },
        dom.attr('type', 'number'),
      ),
      cssInput(
        email, { onInput: true, },
        { name: "email" },
        dom.boolAttr('hidden', true),
      ),
      cssButtonGroup(
         bigPrimaryButton(
           dom.domComputed(code, c => c ?
                           'Apply verification code' : 'Resend verification email')
        ),
        bigBasicButtonLink('More sign-up options',
                           {href: getSignupUrl()})
      )
    );
  }

  /**
   * Builds a form to ask the new user a few questions.
   */
  private _buildInfoForm(owner: MultiHolder) {
    const allFilled = Observable.create(owner, false);
    const whereObs = Observable.create(owner, '');
    const pending = Observable.create(owner, false);

    return forms.form({method: "post", action: location.href },
      handleSubmit(pending),
      (elem) => { setTimeout(() => elem.focus(), 0); },
      forms.text('Please help us serve you better by answering a few questions.'),
      forms.question(
        forms.text('Where do you plan to use Grist?'),
        forms.checkboxItem([{name: 'use_work'}], 'Work'),
        forms.checkboxItem([{name: 'use_school'}], 'School'),
        forms.checkboxItem([{name: 'use_personal'}], 'Personal'),
        forms.textBox({name: 'company'},
          dom.hide(use => !use(whereObs)),
          dom.attr('placeholder', (use) => use(whereObs) === 'school' ? 'Your School' : 'Your Company')
        ),
      ),
      forms.question(
        forms.text('What brings you to Grist?'),
        forms.checkboxItem([{name: 'reason_problem'}], 'Solve a particular problem or need'),
        forms.checkboxItem([{name: 'reason_tool'}], 'Find a better tool than the one I am using'),
        forms.checkboxItem([{name: 'reason_curious'}], 'Just curious about a new product'),
        forms.checkboxOther([{name: 'reason_other'}], {name: 'other_reason', placeholder: 'Other...'}),
      ),
      forms.question(
        forms.text('What kind of industry do you work in?'),
        forms.textBox({name: 'industry', placeholder: 'Your answer'}),
      ),
      forms.question(
        forms.text('What is your role?'),
        forms.textBox({name: 'role', placeholder: 'Your answer'}),
      ),
      dom.on('change', (e, form) => {
        allFilled.set(forms.isFormFilled(form, ['use_*', 'reason_*', 'industry', 'role']));
        whereObs.set(form.use_work.checked ? 'work' : form.use_school.checked ? 'school' : '');
      }),
      cssButtonGroup(
        cssButtonGroup.cls('-right'),
        bigBasicButton('Continue',
          cssButton.cls('-primary', allFilled),
          dom.boolAttr('disabled', pending),
          {tabIndex: '0'},
          testId('continue-button')),
      ),
      testId('info-form'),
    );
  }

  private async _fetchOrgs() {
    this._orgs = await this._appModel.api.getOrgs(true);
    this._orgsLoaded.set(true);
  }


  private _buildOrgPicker(): DomContents {
    this._fetchOrgs().catch(reportError);
    return dom.maybe(this._orgsLoaded, () => {
      let orgs = this._orgs;
      if (orgs && orgs.length > 1) {

        // Let's make sure that the first org is not the personal org.
        if (orgs[0].owner) {
          orgs = [...orgs.slice(1), orgs[0]];
        }

        return [
          cssParagraph(
            "You've been added to a team. ",
            "Go to the team site, or to your personal site."
          ),
          cssParagraph(
            "You can always switch sites using the account menu in the top-right corner."
          ),
          orgs.map((org, i) => (
            cssOrgButton(
              getOrgName(org),
              urlState().setLinkUrl({org: org.domain || undefined}),
              testId('org'),
              i ? cssButton.cls('-primary', false) : null
            )
          )),
        ];
      }
    });
  }
}

const cssScrollContainer = styled('div', `
  display: flex;
  overflow-y: auto;
  flex-direction: column;
`);

const cssContainer = styled('div', `
  max-width: 450px;
  align-self: center;
  margin: 60px;
  display: flex;
  flex-direction: column;
  &:after {
    content: "";
    height: 8px;
  }
  @media ${mediaSmall} {
    & {
      margin: 24px;
    }
  }
`);

const cssFlexSpace = styled('div', `
  flex: 1 1 0px;
`);

const cssTitle = styled('div', `
  height: 32px;
  line-height: 32px;
  margin: 0 0 28px 0;
  color: ${colors.dark};
  font-size: ${vars.xxxlargeFontSize};
  font-weight: ${vars.headerControlTextWeight};
`);

const textStyle = `
  font-weight: normal;
  font-size: ${vars.mediumFontSize};
  color: ${colors.dark};
`;

const cssLabel = styled('label', textStyle);
// TODO: there's probably a much better way to style labels with a bit of
// space between them and things they are not the label for?
const cssSeparatedLabel = styled('label', textStyle + ' margin-top: 20px;');
const cssParagraph = styled('p', textStyle);

const cssButtonGroup = styled('div', `
  margin-top: 24px;
  display: flex;
  justify-content: space-evenly;
  &-right {
    justify-content: flex-end;
  }
`);

const cssWarning = styled('div', `
  color: red;
`);

const cssInput = styled(input, BillingPageCss.inputStyle);

const cssOrgButton = styled(bigPrimaryButtonLink, `
  margin: 0 0 8px;
  width: 200px;
  text-overflow: ellipsis;
  white-space: nowrap;
  overflow: hidden;

  &:first-of-type {
    margin-top: 16px;
  }
`);

/**
 * We allow alphanumeric characters and certain common whitelisted characters (except at the start),
 * plus everything non-ASCII (for non-English alphabets, which we want to allow but it's hard to be
 * more precise about what exactly to allow).
 */
// eslint-disable-next-line no-control-regex
const VALID_NAME_REGEXP = /^(\w|[^\u0000-\u007F])(\w|[- ./'"()]|[^\u0000-\u007F])*$/;

/**
 * Test name against various rules to check if it is a valid username. Returned obj has `.valid` set
 * to true if all  passes, otherwise it has the `.flag` set the the first failing test.
 */
export function checkName(name: string): boolean {
  return VALID_NAME_REGEXP.test(name);
}

/**
 * Builds dom to show marning messages to the user.
 */
export function buildNameWarningsDom() {
  return cssWarning(
    "Names only allow letters, numbers and certain special characters",
    testId('username-warning'),
  );
}
