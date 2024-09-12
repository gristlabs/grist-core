import {autoFocus} from 'app/client/lib/domUtils';
import {makeT} from 'app/client/lib/localization';
import {ValidationGroup, Validator} from 'app/client/lib/Validator';
import {AppModel, getHomeUrl} from 'app/client/models/AppModel';
import {reportError, UserError} from 'app/client/models/errors';
import {urlState} from 'app/client/models/gristUrlState';
import {bigBasicButton, bigPrimaryButton, bigPrimaryButtonLink} from 'app/client/ui2018/buttons';
import {mediaSmall, theme, vars} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {IModalControl, modal} from 'app/client/ui2018/modals';
import {TEAM_PLAN} from 'app/common/Features';
import {checkSubdomainValidity} from 'app/common/orgNameUtils';
import {UserAPIImpl} from 'app/common/UserAPI';
import {PlanSelection} from 'app/common/BillingAPI';
import {Disposable, dom, DomContents, DomElementArg, input, makeTestId, Observable, styled} from 'grainjs';

const t = makeT('CreateTeamModal');
const testId = makeTestId('test-create-team-');

export async function buildNewSiteModal(context: Disposable, options: {
  appModel: AppModel,
  plan?: PlanSelection,
  onCreate?: () => void
}): Promise<void> {
  const { onCreate } = options;

  showModal(
    context,
    (_owner: Disposable, ctrl: IModalControl) => dom.create(NewSiteModalContent, ctrl, onCreate),
    dom.cls(cssModalIndex.className),
  );
}

class NewSiteModalContent extends Disposable {
  private _page = Observable.create(this, 'createTeam');
  private _team = Observable.create(this, '');
  private _domain = Observable.create(this, '');
  private _ctrl: IModalControl;

  constructor(
    ctrl: IModalControl,
    private _onCreate?: (planName: string) => void) {
    super();
    this._ctrl = ctrl;
  }

  public buildDom() {
    const team = this._team;
    const domain = this._domain;
    const ctrl = this._ctrl;
    return dom.domComputed(this._page, pageValue => {

      switch (pageValue) {
        case 'createTeam': return buildTeamPage({
          team,
          domain,
          create: () => this._createTeam(),
          ctrl
        });
        case 'teamSuccess': return buildConfirm({domain: domain.get()});
      }
    });
  }

  private async _createTeam() {
    const api = new UserAPIImpl(getHomeUrl());
    try {
      await api.newOrg({name: this._team.get(), domain: this._domain.get()});
      this._page.set('teamSuccess');
      if (this._onCreate) {
        this._onCreate(TEAM_PLAN);
      }
    } catch (err) {
      reportError(err as Error);
    }
  }
}

export function buildUpgradeModal(owner: Disposable, options: {
  appModel: AppModel,
  pickPlan?: PlanSelection,
  reason?: 'upgrade' | 'renew',
}): Promise<void> {
  throw new UserError(t(`Billing is not supported in grist-core`));
}

export class UpgradeButton extends Disposable {
  constructor(_appModel: AppModel) {
    super();
  }

  public buildDom() { return null; }
}

export function buildConfirm({
  domain,
}: {
  domain: string;
}) {
  return cssConfirmWrapper(
    cssSparks(),
    hspace('1.5em'),
    cssHeaderLine(t('Team site created'), testId("confirmation")),
    hspace('2em'),
    bigPrimaryButtonLink(
      urlState().setLinkUrl({org: domain || undefined}), t('Go to your site'), testId("confirmation-link")
    )
  );
}

function buildTeamPage({
  team,
  domain,
  create,
  ctrl
}: {
  team: Observable<string>;
  domain: Observable<string>;
  create: () => any;
  ctrl: IModalControl;
}) {
  const disabled = Observable.create(null, false);
  const group = new ValidationGroup();
  async function click() {
    disabled.set(true);
    try {
      if (!await group.validate()) {
        return;
      }
      await create();
    } finally {
      if (!disabled.isDisposed()) {
        disabled.set(false);
      }
    }
  }
  const clickOnEnter = dom.onKeyPress({
    Enter: () => click(),
  });
  return cssWide(
    dom.autoDispose(disabled),
    cssHeaderLine(t("Work as a Team"), testId("creation-title")),
    cssSubHeaderLine(t("Choose a name and url for your team site")),
    hspace('1.5em'),
    cssColumns(
      cssSetup(
        cssLabel(t('Team name')),
        cssRow(cssField(cssInput(
          team,
          {onInput: true},
          autoFocus(),
          group.inputReset(),
          clickOnEnter,
          testId('name')))),
        dom.create(Validator, group, t("Team name is required"), () => !!team.get()),
        hspace('2em'),
        cssLabel(t('Team url')),
        cssRow(
          {style: 'align-items: baseline'},
          cssField(
            {style: 'flex: 0 1 0; min-width: auto; margin-right: 5px'},
            dom.text(`${window.location.origin}/o/`)),
          cssField(cssInput(
            domain, {onInput: true}, clickOnEnter, group.inputReset(), testId('domain')
          )),
        ),
        dom.create(Validator, group, t("Domain name is required"), () => !!domain.get()),
        dom.create(Validator, group, t("Domain name is invalid"), () => checkSubdomainValidity(domain.get())),
        cssButtonsRow(
          bigBasicButton(
            t('Cancel'),
            dom.on('click', () => ctrl.close()),
            testId('cancel')),
          bigPrimaryButton(t("Create site"),
            dom.on('click', click),
            dom.prop('disabled', disabled),
            testId('confirm')
          ),
        )
      )
    )
  );
}

function showModal(
  context: Disposable,
  content: (owner: Disposable, ctrl: IModalControl) => DomContents,
  ...args: DomElementArg[]
) {
  let control!: IModalControl;
  modal((ctrl, modalScope) => {
    control = ctrl;
    // When parent is being disposed and we are still visible, close the modal.
    context.onDispose(() => {
      // If the modal is already closed (disposed, do nothing)
      if (modalScope.isDisposed()) {
        return;
      }
      // If not, and parent is going away, close the modal.
      ctrl.close();
    });
    return [
      cssCreateTeamModal.cls(''),
      cssCloseButton(testId("close-modal"), cssBigIcon('CrossBig'), dom.on('click', () => ctrl.close())),
      content(modalScope, ctrl)
    ];
  }, {backerDomArgs: args});
  return control;
}

function hspace(height: string) {
  return dom('div', {style: `height: ${height}`});
}

export const cssCreateTeamModal = styled('div', `
  position: relative;
  @media ${mediaSmall} {
    & {
      width: 100%;
      min-width: unset;
      padding: 24px 16px;
    }
  }
`);

const cssConfirmWrapper = styled('div', `
  text-align: center;
`);

const cssSparks = styled('div', `
  height: 48px;
  width: 48px;
  background-image: var(--icon-Sparks);
  display: inline-block;
  background-repeat: no-repeat;
  &-small {
    height: 20px;
    width: 20px;
    background-size: cover;
  }
`);

const cssColumns = styled('div', `
  display: flex;
  gap: 60px;
  flex-wrap: wrap;
`);

const cssSetup = styled('div', `
  display: flex;
  flex-direction: column;
  flex-grow: 1;
`);

const cssHeaderLine = styled('div', `
  text-align: center;
  font-size: 24px;
  font-weight: 600;
  margin-bottom: 16px;
`);

const cssSubHeaderLine = styled('div', `
  text-align: center;
  margin-bottom: 7px;
`);

const cssLabel = styled('label', `
  font-weight: ${vars.headerControlTextWeight};
  font-size: ${vars.mediumFontSize};
  color: ${theme.text};
  line-height: 1.5em;
  margin: 0px;
  margin-bottom: 0.3em;
`);


const cssWide = styled('div', `
  min-width: 760px;
  @media ${mediaSmall} {
    & {
      min-width: unset;
    }
  }
`);

const cssRow = styled('div', `
  display: flex;
`);

const cssField = styled('div', `
  display: block;
  flex: 1 1 0;
  margin: 4px 0;
  min-width: 120px;
`);


const cssButtonsRow = styled('div', `
  display: flex;
  justify-content: flex-end;
  margin-top: 20px;
  min-width: 250px;
  gap: 10px;
  flex-wrap: wrap;
  @media ${mediaSmall} {
    & {
      margin-top: 60px;
    }
  }
`);

const cssCloseButton = styled('div', `
  position: absolute;
  top: 8px;
  right: 8px;
  padding: 4px;
  border-radius: 4px;
  cursor: pointer;
  --icon-color: ${theme.modalCloseButtonFg};

  &:hover {
    background-color: ${theme.hover};
  }
`);

const cssBigIcon = styled(icon, `
  padding: 12px;
`);

const cssModalIndex = styled('div', `
  z-index: ${vars.pricingModalZIndex}
`);

const cssInput = styled(input, `
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
