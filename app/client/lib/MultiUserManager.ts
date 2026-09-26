import { IOrgMemberSelectOption, UserManagerModel } from "app/client/models/UserManagerModel";
import { textarea } from "app/client/ui/inputs";
import { bigBasicButton, bigPrimaryButton } from "app/client/ui2018/buttons";
import { mediaXSmall, testId, theme, vars } from "app/client/ui2018/cssVars";
import { icon } from "app/client/ui2018/icons";
import { menu, menuItem } from "app/client/ui2018/menus";
import { cssAnimatedModal, cssModalBody, cssModalButtons, cssModalTitle,
  IModalControl, modal } from "app/client/ui2018/modals";
import { isEmail } from "app/common/gutil";
import { BasicRole, isBasicRole, NonGuestRole, VIEWER } from "app/common/roles";

import { computed, Computed, dom, DomElementArg, IDisposableOwner, Observable, styled } from "grainjs";

/**
 * Splits the text entered into the "Invite multiple" dialog into a list of emails. Emails are
 * normally entered one per line, but may also be separated by commas, semicolons, or spaces.
 */
export function parseEmailList(emailListRaw: string): string[] {
  return emailListRaw
    .split(/[\s,;]+/)
    .map(email => email.toLowerCase())
    .filter(email => email !== "");
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
    use => Boolean(use(emailListObs) && use(rolesObs) && use(isValidObs)),
  );

  const save = (ctl: IModalControl) => {
    const emailList = parseEmailList(emailListObs.get());
    const role = rolesObs.get();
    if (emailList.some(email => !isEmail(email))) {
      isValidObs.set(false);
    } else {
      emailList.forEach(email => onAdd(email, role));
      ctl.close();
    }
  };

  return modal(ctl => [
    { style: "padding: 0;" },
    dom.cls(cssAnimatedModal.className),
    cssTitle(
      "Invite Users",
      testId("um-header"),
    ),
    cssModalBody(
      cssUserManagerBody(
        buildEmailsTextarea(emailListObs, isValidObs),
        dom.maybe(use => !use(isValidObs), () => cssErrorMessage("At least one email is invalid")),
        cssInheritRoles(
          dom("span", "Access: "),
          buildRolesSelect(rolesObs, model),
        ),
      ),
    ),
    cssModalButtons(
      { style: "margin: 32px 64px; display: flex;" },
      bigPrimaryButton("Confirm",
        dom.boolAttr("disabled", use => !use(enableAdd)),
        dom.on("click", () => save(ctl)),
        testId("um-confirm"),
      ),
      bigBasicButton(
        "Cancel",
        dom.on("click", () => ctl.close()),
        testId("um-cancel"),
      ),
    ),
  ]);
}

function buildRolesSelect(
  roleSelectedObs: Observable<BasicRole>,
  model: UserManagerModel,
) {
  const allRoles = (model.isOrg ? model.orgUserSelectOptions : model.userSelectOptions)
    .filter((x): x is { value: BasicRole, label: string } => isBasicRole(x.value));
  return cssOptionBtn(
    menu(() => [
      dom.forEach(allRoles, _role =>
        menuItem(() => roleSelectedObs.set(_role.value), _role.label,
          testId(`um-role-option`),
        ),
      ),
    ]),
    dom.text((use) => {
      // Get the label of the active role.
      const activeRole = allRoles.find((_role: IOrgMemberSelectOption) => use(roleSelectedObs) === _role.value);
      return activeRole ? activeRole.label : "";
    }),
    cssCollapseIcon("Collapse"),
    testId("um-role-select"),
  );
}

function buildEmailsTextarea(
  emailListObs: Observable<string>,
  isValidObs: Observable<boolean>,
  ...args: DomElementArg[]
) {
  return cssTextarea(emailListObs,
    { onInput: true, isValid: isValidObs },
    { placeholder: "Enter email addresses, one per line or separated by commas" },
    dom.on("change", _ev => isValidObs.set(true)),
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

const cssInheritRoles = styled("span", `
  margin: 13px 63px 42px;
`);

const cssErrorMessage = styled("span", `
  margin: 0 63px;
  color: ${theme.errorText};
`);

const cssOptionBtn = styled("span", `
  display: inline-flex;
  font-size: ${vars.mediumFontSize};
  color: ${theme.controlFg};
  cursor: pointer;
`);

const cssCollapseIcon = styled(icon, `
  margin-top: 1px;
  background-color: ${theme.controlFg};
`);

const cssAccessDetailsBody = styled("div", `
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
