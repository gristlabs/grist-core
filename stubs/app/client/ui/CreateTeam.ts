import { autoFocus } from 'app/client/lib/domUtils';
import { ValidationGroup, Validator } from 'app/client/lib/Validator';
import { AppModel, getHomeUrl } from 'app/client/models/AppModel';
import { reportError, UserError } from 'app/client/models/errors';
import { urlState } from 'app/client/models/gristUrlState';
import { UpgradeButton } from 'app/client/ui/ProductUpgradesStub';
import { bigBasicButton, bigPrimaryButton, bigPrimaryButtonLink } from 'app/client/ui2018/buttons';
import { mediaSmall, theme, vars } from 'app/client/ui2018/cssVars';
import { icon } from 'app/client/ui2018/icons';
import { IModalControl, modal } from 'app/client/ui2018/modals';
import { TEAM_PLAN } from 'app/common/Features';
import { checkSubdomainValidity } from 'app/common/orgNameUtils';
import { UserAPIImpl } from 'app/common/UserAPI';
import {
  Disposable, dom, DomContents, DomElementArg, IDisposableOwner, input, makeTestId,
  Observable, styled
} from 'grainjs';

const testId = makeTestId('test-create-team-');

/**
 * Product upgrade UI.
 *
 * Contains and exposes 4 elements:
 * - New site modal (modal shown after pressing new site button)
 * - Upgrade modal (modal shown after pressing upgrade button or link)
 * - FreeTeam upgrade nudge shown on the home screen on personal orgs
 * - Upgrade button that is shown in the doc list header
 *   NOTE: upgrade button for free personal site is called "Create site"
 *
 * For Free personal site - there is no upgrade logic yet, so all upgrades are actually routed to new
 * site creation modal. For example Upgrade button for free personal org is called Create site and will
 * display create site modal instead of an upgrade.
 */

export function buildNewSiteModal(context: Disposable, options: {
  planName: string,
  selectedPlan?: string,
  onCreate?: () => void
}) {
  const { onCreate } = options;

  return showModal(
    context,
    () => dom.create(NewSiteModalContent, onCreate),
    dom.cls(cssModalIndex.className),
  );
}

class NewSiteModalContent extends Disposable {
  private _page = Observable.create(this, 'createTeam');
  private _team = Observable.create(this, '');
  private _domain = Observable.create(this, '');

  constructor(
    private _onCreate?: (planName: string) => void) {
    super();
  }

  public buildDom() {
    const team = this._team;
    const domain = this._domain;
    return dom.domComputed(this._page, pageValue => {

      switch (pageValue) {
        case 'createTeam': return buildTeamPage({
          team,
          domain,
          create: () => this._createTeam()
        });
        case 'teamSuccess': return buildConfirm({ domain: domain.get() });
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

export function buildUpgradeModal(owner: Disposable, planName: string): void {
  throw new UserError(`There is no plan logical in this instance of Grist`);
}

export function buildUpgradeButton(owner: IDisposableOwner, app: AppModel): UpgradeButton {
  return {
    showUpgradeCard : () => null,
    showUpgradeButton : () => null,
  };
}

export function buildConfirm({
  domain,
}: {
  domain: string;
}) {
  return cssConfirmWrapper(
    cssSparks(),
    hspace('22px'),
    cssHeaderLine('Team site created', testId("confirmation")),
    hspace('40px'),
    bigPrimaryButtonLink(
      urlState().setLinkUrl({ org: domain || undefined }), 'Go to your site', testId("confirmation-link")
      )
  );
}

function buildTeamPage({
  team,
  domain,
  create
}: {
  team: Observable<string>;
  domain: Observable<string>;
  create: () => any;
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
      disabled.set(false);
    }
  }
  const clickOnEnter = dom.onKeyPress({
    Enter: () => click(),
  });
  return cssWide(
    cssHeaderLine("Work as a Team"),
    cssSubHeaderLine("Choose a name and url for your team site"),
    hspace('24px'),
    cssColumns(
      cssSetup(
        cssPaymentLabel('Team name'),
        cssPaymentRow(cssPaymentField(cssBillingInput(
          team,
          { onInput: true },
          autoFocus(),
          group.inputReset(),
          clickOnEnter,
          testId('name')))),
        dom.create(Validator, group, "Team name is required", () => !!team.get()),
        hspace('2em'),
        cssPaymentLabel('Team url'),
        cssPaymentRow(
          { style: 'align-items: baseline' },
          cssPaymentField(
            { style: 'flex: 0 1 0; min-width: auto; margin-right: 5px' },
            dom.text(`${window.location.origin}/o/`)),
          cssPaymentField(cssBillingInput(
            domain, { onInput: true }, clickOnEnter, group.inputReset(), testId('domain')
          )),
        ),
        dom.create(Validator, group, "Domain name is required", () => !!domain.get()),
        dom.create(Validator, group, "Domain name is invalid", () => checkSubdomainValidity(domain.get())),
        cssButtonsRow(
          bigBasicButton(
            'Cancel',
            // close modal
            dom.on('click', () => {}),
            // dom.on('click', ctrl.close()),
            testId('cancel')),
          bigPrimaryButton("Create site",
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
      cssUpgradeModal.cls(''),
      cssCloseButton(testId("close-modal"), cssBigIcon('CrossBig'), dom.on('click', () => ctrl.close())),
      content(modalScope, ctrl)
    ];
  }, { backerDomArgs: args });
  return control;
}

function hspace(height: string) {
  return dom('div', { style: `height: ${height}` });
}

export const cssUpgradeModal = styled('div', `
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

const cssPaymentLabel2 = styled('label', `
  font-weight: ${vars.headerControlTextWeight};
  font-size: ${vars.mediumFontSize};
  color: ${theme.text};
  line-height: 38px;
`);

const cssPaymentLabel = styled(cssPaymentLabel2, `
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

const cssPaymentRow = styled('div', `
  display: flex;
`);

const cssPaymentField = styled('div', `
  display: block;
  flex: 1 1 0;
  margin: 4px 0;
  min-width: 120px;
`);


const cssButtonsRow = styled('div', `
  display: flex;
  justify-content: flex-end;
  margin-top: auto;
  min-width: 250px;
  gap: 10px;
  flex-wrap: wrap;
  @media ${mediaSmall} {
    & {
      margin-top: 60px;
    }
  }
`);

export const cssCloseButton = styled('div', `
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

const cssBillingInput = styled(input, `
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
