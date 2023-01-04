import {computed, Computed, dom, DomElementArg, IDisposableOwner, Observable, styled} from "grainjs";
import {cssAnimatedModal, cssModalBody, cssModalButtons, cssModalTitle,
        IModalControl, modal} from 'app/client/ui2018/modals';
import {bigBasicButton, bigPrimaryButton} from 'app/client/ui2018/buttons';
import {mediaXSmall, testId, theme, vars} from 'app/client/ui2018/cssVars';
import {IOrgMemberSelectOption, UserManagerModel} from 'app/client/models/UserManagerModel';
import {icon} from 'app/client/ui2018/icons';
import {textarea} from "app/client/ui/inputs";
import {BasicRole, isBasicRole, NonGuestRole, VIEWER} from "app/common/roles";
import {menu, menuItem} from 'app/client/ui2018/menus';

function parseEmailList(emailListRaw: string): Array<string> {
  return emailListRaw
    .split('\n')
    .map(email => email.trim().toLowerCase())
    .filter(email => email !== "");
}

function validateEmail(email: string): boolean {
  const mailformat = /\S+@\S+\.\S+/;
  return mailformat.test(email);
}

export function buildMultiUserManagerModal(
  owner: IDisposableOwner,
  model: UserManagerModel,
  onAdd: (email: string, role: NonGuestRole) => void,
) {
  const emailListObs = Observable.create(owner, "");
  const rolesObs = Observable.create<BasicRole>(owner, VIEWER);
  const isValidObs = Observable.create(owner, true);

  const enableAdd: Computed<boolean> = computed(
    (use) => Boolean(use(emailListObs) && use(rolesObs) && use(isValidObs))
  );

  const save = (ctl: IModalControl) => {
    const emailList = parseEmailList(emailListObs.get());
    const role = rolesObs.get();
    if (emailList.some(email => !validateEmail(email))) {
      isValidObs.set(false);
    } else {
      emailList.forEach(email => onAdd(email, role));
      ctl.close();
    }
  };

  return modal(ctl => [
    { style: 'padding: 0;' },
    dom.cls(cssAnimatedModal.className),
    cssTitle(
      'Invite Users',
      testId('um-header'),
    ),
    cssModalBody(
      cssUserManagerBody(
        buildEmailsTextarea(emailListObs, isValidObs),
        dom.maybe(use => !use(isValidObs), () => cssErrorMessage('At least one email is invalid')),
        cssInheritRoles(
          dom('span', 'Access: '),
          buildRolesSelect(rolesObs, model)
        )
      ),
    ),
    cssModalButtons(
      { style: 'margin: 32px 64px; display: flex;' },
      bigPrimaryButton('Confirm',
        dom.boolAttr('disabled', (use) => !use(enableAdd)),
        dom.on('click', () => save(ctl)),
        testId('um-confirm')
      ),
      bigBasicButton(
        'Cancel',
        dom.on('click', () => ctl.close()),
        testId('um-cancel')
      ),
    )
  ]);
}

function buildRolesSelect(
  roleSelectedObs: Observable<BasicRole>,
  model: UserManagerModel,
) {
  const allRoles = (model.isOrg ? model.orgUserSelectOptions : model.userSelectOptions)
    .filter((x): x is {value: BasicRole, label: string} => isBasicRole(x.value));
  return cssOptionBtn(
    menu(() => [
      dom.forEach(allRoles, (_role) =>
        menuItem(() => roleSelectedObs.set(_role.value), _role.label,
          testId(`um-role-option`)
        )
      )
    ]),
    dom.text((use) => {
      // Get the label of the active role.
      const activeRole = allRoles.find((_role: IOrgMemberSelectOption) => use(roleSelectedObs) === _role.value);
      return activeRole ? activeRole.label : "";
    }),
    cssCollapseIcon('Collapse'),
    testId('um-role-select')
  );
}


function buildEmailsTextarea(
  emailListObs: Observable<string>,
  isValidObs: Observable<boolean>,
  ...args: DomElementArg[]
) {
  return cssTextarea(emailListObs,
    {onInput: true, isValid: isValidObs},
    {placeholder: "Enter one email address per line"},
    dom.on('change', (_ev) => isValidObs.set(true)),
     ...args,
  );
}


const cssTitle = styled(cssModalTitle, `
  margin: 40px 64px 0 64px;

  @media ${mediaXSmall} {
    & {
      margin: 16px;
    }
  }
`);

const cssInheritRoles = styled('span', `
  margin: 13px 63px 42px;
`);

const cssErrorMessage = styled('span', `
  margin: 0 63px;
  color: ${theme.errorText};
`);

const cssOptionBtn = styled('span', `
  display: inline-flex;
  font-size: ${vars.mediumFontSize};
  color: ${theme.controlFg};
  cursor: pointer;
`);

const cssCollapseIcon = styled(icon, `
  margin-top: 1px;
  background-color: ${theme.controlFg};
`);

const cssAccessDetailsBody = styled('div', `
  display: flex;
  flex-direction: column;
  width: 600px;
  font-size: ${vars.mediumFontSize};
`);

const cssUserManagerBody = styled(cssAccessDetailsBody, `
  height: 374px;
  border-bottom: 1px solid ${theme.modalBorderDark};
`);

const cssTextarea = styled(textarea, `
  margin: 16px 63px;
  padding: 12px 10px;
  border-radius: 3px;
  resize: none;
  border: 1px solid ${theme.inputBorder};
  color: ${theme.inputFg};
  background-color: ${theme.inputBg};
  flex: 1 1 0;
  font-size: ${vars.mediumFontSize};
  font-family: ${vars.fontFamily};
  outline: none;

  &::placeholder {
    color: ${theme.inputPlaceholderFg};
  }
`);
