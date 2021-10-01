/**
 * This module exports a UserManager component, consisting of a list of emails, each with an
 * associated role (See app/common/roles), and a way to change roles, and add or remove new users.
 * The component is instantiated as a modal with a confirm button to pass changes to the server.
 *
 * It can be instantiated by calling showUserManagerModal with the UserAPI and IUserManagerOptions.
 */
import {FullUser} from 'app/common/LoginSessionAPI';
import * as roles from 'app/common/roles';
import {tbind} from 'app/common/tbind';
import {PermissionData, UserAPI} from 'app/common/UserAPI';
import {computed, Computed, Disposable, observable, Observable} from 'grainjs';
import {dom, DomElementArg, styled} from 'grainjs';
import {cssMenuItem} from 'popweasel';

import {copyToClipboard} from 'app/client/lib/copyToClipboard';
import {setTestState} from 'app/client/lib/testState';
import {DocPageModel} from 'app/client/models/DocPageModel';
import {reportError} from 'app/client/models/errors';
import {urlState} from 'app/client/models/gristUrlState';
import {IEditableMember, IMemberSelectOption, IOrgMemberSelectOption} from 'app/client/models/UserManagerModel';
import {UserManagerModel, UserManagerModelImpl} from 'app/client/models/UserManagerModel';
import {getResourceParent, ResourceType} from 'app/client/models/UserManagerModel';
import {shadowScroll} from 'app/client/ui/shadowScroll';
import {showTransientTooltip} from 'app/client/ui/tooltips';
import {createUserImage, cssUserImage} from 'app/client/ui/UserImage';
import {cssEmailInput, cssEmailInputContainer, cssMailIcon, cssMemberBtn, cssMemberImage, cssMemberListItem,
        cssMemberPrimary, cssMemberSecondary, cssMemberText, cssRemoveIcon} from 'app/client/ui/UserItem';
import {basicButton, bigBasicButton, bigPrimaryButton} from 'app/client/ui2018/buttons';
import {colors, testId, vars} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {cssLink} from 'app/client/ui2018/links';
import {inputMenu, menu, menuItem, menuText} from 'app/client/ui2018/menus';
import {cssModalBody, cssModalButtons, cssModalTitle, IModalControl, modal} from 'app/client/ui2018/modals';

export interface IUserManagerOptions {
  permissionData: Promise<PermissionData>;
  activeEmail: string|null;
  resourceType: ResourceType;
  resourceId: string|number;
  docPageModel?: DocPageModel;
  linkToCopy?: string;
  onSave?: () => Promise<unknown>;
}

// Returns an instance of UserManagerModel given IUserManagerOptions. Makes the async call for the
// required properties of the options.
async function getModel(options: IUserManagerOptions): Promise<UserManagerModelImpl> {
  const permissionData = await options.permissionData;
  return new UserManagerModelImpl(permissionData, options.resourceType, options.activeEmail,
    options.docPageModel);
}

/**
 * Public interface for creating the UserManager in the app. Creates a modal that includes
 * the UserManager menu with save and cancel buttons.
 */
export function showUserManagerModal(userApi: UserAPI, options: IUserManagerOptions) {
  const modelObs: Observable<UserManagerModel|null> = observable(null);

  async function onConfirm(ctl: IModalControl) {
    const model = modelObs.get();
    if (model) {
      // Save changes to the server, reporting any errors to the app.
      try {
        if (model.isAnythingChanged.get()) {
          await model.save(userApi, options.resourceId);
        }
        await options.onSave?.();
        ctl.close();
      } catch (err) {
        reportError(err);
      }
    } else {
      ctl.close();
    }
  }

  // Get the model and assign it to the observable. Report errors to the app.
  getModel(options)
    .then(model => modelObs.set(model))
    .catch(reportError);
  modal(ctl => [
    // We set the padding to 0 since the body scroll shadows extend to the edge of the modal.
    { style: 'padding: 0;' },

    cssModalTitle(
      { style: 'margin: 40px 64px 0 64px;' },
      `Invite people to ${renderType(options.resourceType)}`,
      (options.resourceType === 'document' ? makeCopyBtn(options.linkToCopy, cssCopyBtn.cls('-header')) : null),
      testId('um-header')
    ),

    cssModalBody(
      cssUserManagerBody(
        // TODO: Show a loading indicator before the model is loaded.
        dom.maybe(modelObs, model => new UserManager(model, options.linkToCopy).buildDom()),
      ),
    ),
    cssModalButtons(
      { style: 'margin: 32px 64px; display: flex;' },
      bigPrimaryButton('Confirm',
        dom.boolAttr('disabled', (use) => !use(modelObs) || !use(use(modelObs)!.isAnythingChanged)),
        dom.on('click', () => onConfirm(ctl)),
        testId('um-confirm')
      ),
      bigBasicButton('Cancel',
        dom.on('click', () => ctl.close()),
        testId('um-cancel')
      ),
      cssAccessLink({href: urlState().makeUrl({docPage: 'acl'})},
        dom.text(use => (use(modelObs) && use(use(modelObs)!.isAnythingChanged)) ? 'Save & ' : ''),
        'Open Access Rules',
        dom.on('click', (ev) => {
          ev.preventDefault();
          return onConfirm(ctl).then(() => urlState().pushUrl({docPage: 'acl'}));
        }),
      ),
      testId('um-buttons'),
    )
  ]);
}

/**
 * See module documentation for overview.
 *
 * Usage:
 *    const um = new UserManager(model);
 *    um.buildDom();
 */
export class UserManager extends Disposable {
  constructor(private _model: UserManagerModel, private _linkToCopy: string|undefined) {
    super();
  }

  public buildDom() {
    const memberEmail = this.autoDispose(new MemberEmail(tbind(this._model.add, this._model)));
    return [
      memberEmail.buildDom(),
      this._buildOptionsDom(),
      shadowScroll(
        testId('um-members'),
        this._buildPublicAccessMember(),
        dom.forEach(this._model.membersEdited, (member) => this._buildMemberDom(member)),
      ),
    ];
  }

  private _buildOptionsDom(): Element {
    const publicMember = this._model.publicMember;
    return cssOptionRow(
      // TODO: Consider adding a tooltip explaining inheritance. A brief text caption may
      // be used to fill whitespace in org UserManager.
      this._model.isOrg ? null : dom('span', { style: `float: left;` },
        dom('span', 'Inherit access: '),
        this._inheritRoleSelector()
      ),
      publicMember ? dom('span', { style: `float: right;` },
        dom('span', 'Public access: '),
        cssOptionBtn(
          menu(() => [
            menuItem(() => publicMember.access.set(roles.VIEWER), 'On', testId(`um-public-option`)),
            menuItem(() => publicMember.access.set(null), 'Off',
              // Disable null access if anonymous access is inherited.
              dom.cls('disabled', (use) => use(publicMember.inheritedAccess) !== null),
              testId(`um-public-option`)
            ),
            // If the 'Off' setting is disabled, show an explanation.
            dom.maybe((use) => use(publicMember.inheritedAccess) !== null, () => menuText(
              `Public access inherited from ${getResourceParent(this._model.resourceType)}. ` +
              `To remove, set 'Inherit access' option to 'None'.`))
          ]),
          dom.text((use) => use(publicMember.effectiveAccess) ? 'On' : 'Off'),
          cssCollapseIcon('Collapse'),
          testId('um-public-access')
        )
      ) : null
    );
  }

  // Build a single member row.
  private _buildMemberDom(member: IEditableMember) {
    const disableRemove = Computed.create(null, (use) =>
      Boolean(this._model.isActiveUser(member) || use(member.inheritedAccess)));
    return dom('div',
      dom.autoDispose(disableRemove),
      dom.maybe((use) => use(member.effectiveAccess) && use(member.effectiveAccess) !== roles.GUEST, () =>
        cssMemberListItem(
          cssMemberListItem.cls('-removed', (use) => member.isRemoved),
          cssMemberImage(
            createUserImage(getFullUser(member), 'large')
          ),
          cssMemberText(
            cssMemberPrimary(member.name || dom('span', member.email, testId('um-email'))),
            member.name ? cssMemberSecondary(member.email, testId('um-email')) : null
          ),
          member.isRemoved ? null : this._memberRoleSelector(member.effectiveAccess,
            member.inheritedAccess, this._model.isActiveUser(member)),
          // Only show delete buttons when editing the org users or when a user is being newly
          // added to any resource. In workspace/doc UserManager instances we want to see all the
          // users in the org, whether or not they have access to the resource of interest. They may
          // be denied access via the role dropdown.
          // Show the undo icon when an item has been removed but its removal has not been saved to
          // the server.
          cssMemberBtn(
            // Button icon.
            member.isRemoved ? cssUndoIcon('Undo', testId('um-member-undo')) :
              cssRemoveIcon('Remove', testId('um-member-delete')),
            cssMemberBtn.cls('-disabled', disableRemove),
            // Click handler.
            dom.on('click', () => disableRemove.get() ||
              (member.isRemoved ? this._model.add(member.email, member.access.get()) :
                this._model.remove(member)))
          ),
          testId('um-member')
        )
      )
    );
  }

  private _buildPublicAccessMember() {
    const publicMember = this._model.publicMember;
    if (!publicMember) { return null; }
    return dom('div',
      dom.maybe((use) => Boolean(use(publicMember.effectiveAccess)), () =>
        cssMemberListItem(
          cssPublicMemberIcon('PublicFilled'),
          cssMemberText(
            cssMemberPrimary('Public Access'),
            cssMemberSecondary('Anyone with link ', makeCopyBtn(this._linkToCopy)),
          ),
          this._memberRoleSelector(publicMember.effectiveAccess, publicMember.inheritedAccess, false,
            // Only show the Editor and Viewer options for the role of the "Public Access" member.
            this._model.userSelectOptions.filter(opt => [roles.EDITOR, roles.VIEWER].includes(opt.value!))
          ),
          cssMemberBtn(
            cssRemoveIcon('Remove', testId('um-member-delete')),
            dom.on('click', () => publicMember.access.set(null)),
          ),
          testId('um-public-member')
        )
      )
    );
  }

  // Returns a div containing a button that opens a menu to choose between roles.
  private _memberRoleSelector(
    role: Observable<string|null>,
    inherited: Observable<roles.Role|null>,
    isActiveUser: boolean,
    allRolesOverride?: IOrgMemberSelectOption[],
  ) {
    const allRoles = allRolesOverride ||
      (this._model.isOrg ? this._model.orgUserSelectOptions : this._model.userSelectOptions);
    return cssRoleBtn(
      menu(() => [
        dom.forEach(allRoles, _role =>
          // The active user should be prevented from changing their own role.
          menuItem(() => isActiveUser || role.set(_role.value), _role.label,
            // Indicate which option is inherited, if any.
            dom.text((use) => use(inherited) && (use(inherited) === _role.value)
              && !isActiveUser ? ' (inherited)' : ''),
            // Disable everything providing less access than the inherited access
            dom.cls('disabled', (use) =>
              roles.getStrongestRole(_role.value, use(inherited)) !== _role.value),
            testId(`um-role-option`)
          )
        ),
        // If the user's access is inherited, give an explanation on how to change it.
        isActiveUser ? menuText(`User may not modify their own access.`) : null,
        // If the user's access is inherited, give an explanation on how to change it.
        dom.maybe((use) => use(inherited) && !isActiveUser, () => menuText(
          `User inherits permissions from ${getResourceParent(this._model.resourceType)}. To remove, ` +
          `set 'Inherit access' option to 'None'.`)),
        // If the user is a guest, give a description of the guest permission.
        dom.maybe((use) => !this._model.isOrg && use(role) === roles.GUEST, () => menuText(
          `User has view access to ${this._model.resourceType} resulting from manually-set access ` +
          `to resources inside. If removed here, this user will lose access to resources inside.`)),
        this._model.isOrg ? menuText(`No default access allows access to be ` +
          `granted to individual documents or workspaces, rather than the full team site.`) : null
      ]),
      dom.text((use) => {
        // Get the label of the active role. Note that the 'Guest' role is assigned when the role
        // is not found because it is not included as a selection.
        const activeRole = allRoles.find((_role: IOrgMemberSelectOption) => use(role) === _role.value);
        return activeRole ? activeRole.label : "Guest";
      }),
      cssCollapseIcon('Collapse'),
      testId('um-member-role')
    );
  }

  // Builds the max inherited role selection button and menu.
  private _inheritRoleSelector() {
    const role = this._model.maxInheritedRole;
    const allRoles = this._model.inheritSelectOptions;
    return cssOptionBtn(
      menu(() => [
        dom.forEach(allRoles, _role =>
          menuItem(() => role.set(_role.value), _role.label,
            testId(`um-role-option`)
          )
        )
      ]),
      dom.text((use) => {
        // Get the label of the active role.
        const activeRole = allRoles.find((_role: IMemberSelectOption) => use(role) === _role.value);
        return activeRole ? activeRole.label : "";
      }),
      cssCollapseIcon('Collapse'),
      testId('um-max-inherited-role')
    );
  }
}

/**
 * Represents the widget that allows typing in an email and adding it.
 * The border of the input turns green when the email is considered valid.
 */
export class MemberEmail extends Disposable {
  public email = this.autoDispose(observable<string>(""));
  public isEmpty = this.autoDispose(computed<boolean>((use) => !use(this.email)));

  private _isValid = this.autoDispose(observable<boolean>(false));
  private _emailElem: HTMLInputElement;

  constructor(
    private _onAdd: (email: string, role: roles.NonGuestRole) => void
  ) {
    super();
    // Reset custom validity that we sometimes set.
    this.email.addListener(() => this._emailElem.setCustomValidity(""));
  }

  public buildDom(): Element {
    const enableAdd: Computed<boolean> = computed((use) => Boolean(use(this.email) && use(this._isValid)));
    return cssEmailInputContainer(
      dom.autoDispose(enableAdd),
      cssMailIcon('Mail'),
      this._emailElem = cssEmailInput(this.email, {onInput: true, isValid: this._isValid},
        {type: "email", placeholder: "Enter email address"},
        dom.onKeyPress({Enter: () => this._commit()}),
        inputMenu(() => [
          cssInputMenuItem(() => this._commit(),
            cssUserImagePlus('+',
              cssUserImage.cls('-large'),
              cssUserImagePlus.cls('-invalid', (use) => !use(enableAdd))
            ),
            cssMemberText(
              cssMemberPrimary('Invite new member'),
              cssMemberSecondary(
                dom.text((use) => `We'll email an invite to ${use(this.email)}`)
              )
            ),
            testId('um-add-email')
          )
        ], {
          // NOTE: An offset of -40px is used to center the input button across the
          // input container (including an envelope icon) rather than the input inside.
          modifiers: {
            offset: { enabled: true, offset: -40 }
          },
          stretchToSelector: `.${cssEmailInputContainer.className}`
        })
      ),
      cssEmailInputContainer.cls('-green', enableAdd),
      testId('um-member-new')
    );
  }

  // Add the currently entered email if valid, or trigger a validation message if not.
  private _commit() {
    this._emailElem.setCustomValidity("");
    this._isValid.set(this._emailElem.checkValidity());
    if (this.email.get() && this._isValid.get()) {
      try {
        this._onAdd(this.email.get(), roles.VIEWER);
        this._reset();
      } catch (e) {
        this._emailElem.setCustomValidity(e.message);
      }
    }
    this._emailElem.reportValidity();
  }

  // Reset the widget.
  private _reset() {
    this.email.set("");
    this._emailElem.focus();
  }
}

// Returns a new FullUser object from an IEditableMember.
function getFullUser(member: IEditableMember): FullUser {
  return {
    id: member.id,
    name: member.name,
    email: member.email,
    picture: member.picture
  };
}

// Create a "Copy Link" button.
function makeCopyBtn(linkToCopy: string|undefined, ...domArgs: DomElementArg[]) {
  return linkToCopy && cssCopyBtn(cssCopyIcon('Copy'), 'Copy Link',
    dom.on('click', (ev, elem) => copyLink(elem, linkToCopy)),
    testId('um-copy-link'),
    ...domArgs,
  );
}

// Copy the current document link to clipboard, and notify the user with a transient popup near
// the given element.
async function copyLink(elem: HTMLElement, link: string) {
  await copyToClipboard(link);
  setTestState({clipboard: link});
  showTransientTooltip(elem, 'Link copied to clipboard', {key: 'copy-doc-link'});
}

const cssUserManagerBody = styled('div', `
  display: flex;
  flex-direction: column;
  width: 600px;
  height: 374px;
  border-bottom: 1px solid ${colors.darkGrey};
  font-size: ${vars.mediumFontSize};
`);

const cssCopyBtn = styled(basicButton, `
  border: none;
  font-weight: normal;
  padding: 0 8px;
  &-header {
    float: right;
    margin-top: 8px;
  }
`);

const cssCopyIcon = styled(icon, `
  margin-right: 4px;
  margin-top: -2px;
`);

const cssOptionRow = styled('div', `
  font-size: ${vars.mediumFontSize};
  margin: 0 63px 23px 63px;
`);

const cssOptionBtn = styled('span', `
  display: inline-flex;
  font-size: ${vars.mediumFontSize};
  color: ${colors.lightGreen};
  cursor: pointer;
`);

const cssPublicMemberIcon = styled(icon, `
  width: 32px;
  height: 32px;
  margin: 4px 8px;
  --icon-color: ${colors.lightGreen};
`);

const cssUndoIcon = styled(icon, `
  margin: 12px 0;
`);

const cssRoleBtn = styled('div', `
  display: flex;
  justify-content: flex-end;
  font-size: ${vars.mediumFontSize};
  color: ${colors.lightGreen};
  margin: 12px 24px;
  cursor: pointer;

  &.disabled {
    cursor: default;
  }
`);

const cssCollapseIcon = styled(icon, `
  margin-top: 1px;
  background-color: var(--grist-color-light-green);
`);

const cssInputMenuItem = styled(menuItem, `
  height: 64px;
  padding: 8px 15px;
`);

const cssUserImagePlus = styled(cssUserImage, `
  background-color: ${colors.lightGreen};
  margin: auto 0;

  &-invalid {
    background-color: ${colors.mediumGrey};
  }

  .${cssMenuItem.className}-sel & {
    background-color: white;
    color: ${colors.lightGreen};
  }
`);

const cssAccessLink = styled(cssLink, `
  align-self: center;
  margin-left: auto;
`);

// Render the name "organization" as "team site" in UI
function renderType(resourceType: ResourceType): string {
  return resourceType === 'organization' ? 'team site' : resourceType;
}
