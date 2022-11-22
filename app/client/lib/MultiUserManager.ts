import { computed, Computed, dom, DomElementArg, IDisposableOwner, Observable, styled } from "grainjs";
import {cssModalBody, cssModalButtons, cssModalTitle, IModalControl, modal} from 'app/client/ui2018/modals';
import {bigBasicButton, bigPrimaryButton} from 'app/client/ui2018/buttons';
import {mediaXSmall, testId, theme, vars} from 'app/client/ui2018/cssVars';
import {UserManagerModel, IMemberSelectOption} from 'app/client/models/UserManagerModel';
import {icon} from 'app/client/ui2018/icons';
import {
  cssEmailTextarea,
} from "app/client/ui/UserItem";
import { Role, NonGuestRole } from "app/common/roles";
import {menu, menuItem} from 'app/client/ui2018/menus';

function parseEmailList(emailListRaw: string): Array<string> {
  return emailListRaw
    .split('\n')
    .map(email => email.trim())
    .filter(email => email !== "")
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
  const rolesObs = Observable.create(owner, null);
  const isValidObs = Observable.create(owner, true);
  
  const enableAdd: Computed<boolean> = computed((use) => Boolean(use(emailListObs) && use(rolesObs) && use(isValidObs)));
  
  const save = (ctl: IModalControl) => {
    const emailList = parseEmailList(emailListObs.get())
    const role = rolesObs.get();
    if (role === null) return;
    if (emailList.some(email => !validateEmail(email))) {
      isValidObs.set(false);
    } else {
      emailList.map(email => onAdd(email, role))
      ctl.close()
    }
  }
  const cssBody = model.isPersonal ? cssAccessDetailsBody : cssUserManagerBody;

  return modal(ctl => [
    // We set the padding to 0 since the body scroll shadows extend to the edge of the modal.
    { style: 'padding: 0;' },
    cssTitle('Multi'),
    cssModalBody(
      cssBody(
        buildMultiUserManager(emailListObs, isValidObs),
        dom.domComputed(isValidObs, isValid => !isValid ? cssErroMessage('Error, an email is not email') : null),
        cssInheritRoles(
          dom('span', 'Inherit access: '),
          buildRolesSelect(rolesObs, model)
        )
      ),
    ),
    cssModalButtons(
      { style: 'margin: 32px 64px; display: flex;' },
      (model.isPublicMember ? null :
        bigPrimaryButton('Confirm',
          dom.boolAttr('disabled', (use) => !use(enableAdd)),
          dom.on('click', () => {save(ctl)}),
          testId('um-confirm')
        )
      ),
      bigBasicButton(
        model.isPublicMember ? 'Close' : 'Cancel',
        dom.on('click', () => ctl.close()),
        testId('um-cancel')
      ),
    )
  ])
}

function buildRolesSelect(
  roleSelectedObs: Observable<Role|null>,
  model: UserManagerModel,
) {
  const allRoles = model.inheritSelectOptions
  return cssOptionBtn(
    menu(() => [
      dom.forEach(allRoles, _role =>
        menuItem(() => roleSelectedObs.set(_role.value), _role.label,
          testId(`um-role-option`)
        )
      )
    ]),
    dom.text((use) => {
      // Get the label of the active role.
      const activeRole = allRoles.find((_role: IMemberSelectOption) => use(roleSelectedObs) === _role.value);
      return activeRole ? activeRole.label : "";
    }),
    cssCollapseIcon('Collapse'),
    testId('um-max-inherited-role')
  );
}


function buildMultiUserManager(
  emailListObs: Observable<string>,
  isValidObs: Observable<boolean>,
  // model: UserManagerModel,
  ...args: DomElementArg[]
) {
  return cssTextarea(emailListObs,
    {onInput: true, isValid: isValidObs},
    {placeholder: "Enter one email address par mail"},
     ...args,
  )
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
`)

const cssErroMessage = styled('span', `
  margin: 0 63px;
  color: ${theme.errorText}
`)

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

const cssTextarea = styled(cssEmailTextarea, `
  margin: 16px 63px;
  padding: 12px 10px;
  border-radius: 3px;
  border: 1px solid ${theme.inputBorder};
`)
