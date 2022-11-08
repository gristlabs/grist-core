import { dom, DomElementArg, IDisposableOwner, keyframes, Observable, styled } from "grainjs";
import {cssModalBody, cssModalButtons, cssModalTitle, IModalControl,
        modal} from 'app/client/ui2018/modals';
import {bigBasicButton, bigPrimaryButton} from 'app/client/ui2018/buttons';
import {mediaXSmall, testId, theme, vars} from 'app/client/ui2018/cssVars';
import {UserManagerModel, IMemberSelectOption} from 'app/client/models/UserManagerModel';
import {loadingSpinner} from 'app/client/ui2018/loaders';
import { IUserManagerOptions } from "app/client/ui/UserManager";
import {icon} from 'app/client/ui2018/icons';
import {
  cssEmailTextarea,
} from "app/client/ui/UserItem";
import { Role } from "app/common/roles";
import {menu, menuItem} from 'app/client/ui2018/menus';

// import { modal } from "../ui2018/modals";

export function buildMultiUserManagerModal(
  owner: IDisposableOwner,
  modelObs: Observable<UserManagerModel|null|"slow">,
  onConfirm: (ctl: IModalControl) => Promise<void>,
  options: IUserManagerOptions
) {
  const emailListObs = Observable.create(owner, "");
  const rolesObs = Observable.create(owner, null);
  // const _save = (_onAdd) => emailListObs.get
  // const _onAdd = (emailList: Array<string>, role: string) => emailList.map(email => modelObs.get()?.add(email, role)); // modelObs.get().add()
  return modal(ctl => [
    // We set the padding to 0 since the body scroll shadows extend to the edge of the modal.
    { style: 'padding: 0;' },
    options.showAnimation ? dom.cls(cssAnimatedModal.className) : null,
    dom.domComputed(modelObs, model => {
      if (!model) { return null; }
      if (model === "slow") { return cssSpinner(loadingSpinner()); }
      const cssBody = model.isPersonal ? cssAccessDetailsBody : cssUserManagerBody;
      return [
        cssTitle('Multi'),
        cssModalBody(
          cssBody(
            buildMultiUserManager(emailListObs),
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
              dom.boolAttr('disabled', (use) => !use(model.isAnythingChanged)),
              dom.on('click', () => onConfirm(ctl)),
              testId('um-confirm')
            )
          ),
          bigBasicButton(
            model.isPublicMember ? 'Close' : 'Cancel',
            dom.on('click', () => ctl.close()),
            testId('um-cancel')
          ),
        )
      ]
    })
  ])
}

function buildRolesSelect(
  roleSelectedObs: Observable<Role|null>,
  model: UserManagerModel,
  ...args: DomElementArg[]
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
  // model: UserManagerModel,
  ...args: DomElementArg[]
) {
  // const save = (emails: Array<string>, role: roles.Role) => emails.map(email => model.add(email, role));

  return cssTextarea(emailListObs, {}, {placeholder: "Enter one email address par mail"}, ...args)
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


const cssFadeInFromTop = keyframes(`
  from {top: -250px; opacity: 0}
  to {top: 0; opacity: 1}
`);

const cssAnimatedModal = styled('div', `
  animation-name: ${cssFadeInFromTop};
  animation-duration: 0.4s;
  position: relative;
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

const cssSpinner = styled('div', `
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 32px;
`);

const cssTextarea = styled(cssEmailTextarea, `
  margin: 16px 63px;
  padding: 12px 10px;
  border-radius: 3px;
  border: 1px solid ${theme.inputBorder};
`)
