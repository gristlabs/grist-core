import { Computed, Disposable, dom, domComputed, DomContents, input, MultiHolder, Observable, styled } from "grainjs";

import { submitForm } from "app/client/lib/uploads";
import { AppModel, reportError } from "app/client/models/AppModel";
import { urlState } from "app/client/models/gristUrlState";
import { AccountWidget } from "app/client/ui/AccountWidget";
import { appHeader } from 'app/client/ui/AppHeader';
import * as BillingPageCss from "app/client/ui/BillingPageCss";
import * as forms from "app/client/ui/forms";
import { pagePanels } from "app/client/ui/PagePanels";
import { bigBasicButton, bigPrimaryButton, bigPrimaryButtonLink, cssButton } from "app/client/ui2018/buttons";
import { colors, testId, vars } from "app/client/ui2018/cssVars";
import { getOrgName, Organization } from "app/common/UserAPI";

async function _submitForm(form: HTMLFormElement) {
  const result = await submitForm(form);
  const redirectUrl = result.redirectUrl;
  if (!redirectUrl) {
    throw new Error('form failed to redirect');
  }
  window.location.assign(redirectUrl);
}

function handleSubmit(): (elem: HTMLFormElement) => void {
  return dom.on('submit', async (e, form) => {
    e.preventDefault();
    _submitForm(form).catch(reportError);
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

    // delayed focus
    setTimeout(() => inputEl.focus(), 10);

    return form = dom(
      'form',
      { method: "post", action: location.href },
      handleSubmit(),
      cssLabel('Your full name, as you\'d like it displayed to your collaborators.'),
      inputEl = cssInput(
        value, { onInput: true, },
        { name: "username" },
        dom.onKeyDown({Enter: () => isNameValid.get() && _submitForm(form).catch(reportError)}),
      ),
      dom.maybe((use) => use(value) && !use(isNameValid), buildNameWarningsDom),
      cssButtonGroup(
        bigPrimaryButton(
          'Continue',
          dom.boolAttr('disabled', (use) => Boolean(use(value) && !use(isNameValid))),
          testId('continue-button')
        ),
      )
    );
  }

  /**
   * Builds a form to ask the new user a few questions.
   */
  private _buildInfoForm(owner: MultiHolder) {
    const allFilled = Observable.create(owner, false);
    return forms.form({method: "post", action: location.href },
      handleSubmit(),
      (elem) => { setTimeout(() => elem.focus(), 0); },
      forms.text('Please help us serve you better by answering a few questions.'),
      forms.question(
        forms.text('Where do you plan to use Grist?'),
        forms.checkboxItem([{name: 'use_work'}], 'Work'),
        forms.checkboxItem([{name: 'use_personal'}], 'Personal'),
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
      }),
      cssButtonGroup(
        cssButtonGroup.cls('-right'),
        bigBasicButton('Continue',
          cssButton.cls('-primary', allFilled),
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
  width: 450px;
  align-self: center;
  margin: 60px;
  display: flex;
  flex-direction: column;
  &:after {
    content: "";
    height: 8px;
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
const cssParagraph = styled('p', textStyle);

const cssButtonGroup = styled('div', `
  margin-top: 24px;
  display: flex;
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
