/**
 * This module exports a UserManager component, consisting of a list of emails, each with an
 * associated role (See app/common/roles), and a way to change roles, and add or remove new users.
 * The component is instantiated as a modal with a confirm button to pass changes to the server.
 *
 * It can be instantiated by calling showUserManagerModal with the UserAPI and IUserManagerOptions.
 */
import { makeT } from 'app/client/lib/localization';
import {commonUrls} from 'app/common/gristUrls';
import {capitalizeFirstWord, isLongerThan} from 'app/common/gutil';
import {FullUser} from 'app/common/LoginSessionAPI';
import * as roles from 'app/common/roles';
import {Organization, PermissionData, UserAPI} from 'app/common/UserAPI';
import {Computed, Disposable, dom, DomElementArg, Observable, observable, styled} from 'grainjs';
import pick = require('lodash/pick');

import {ACIndexImpl, normalizeText} from 'app/client/lib/ACIndex';
import {copyToClipboard} from 'app/client/lib/clipboardUtils';
import {setTestState} from 'app/client/lib/testState';
import {buildMultiUserManagerModal} from 'app/client/lib/MultiUserManager';
import {ACUserItem, buildACMemberEmail} from 'app/client/lib/ACUserManager';
import {AppModel} from 'app/client/models/AppModel';
import {DocPageModel} from 'app/client/models/DocPageModel';
import {reportError} from 'app/client/models/errors';
import {urlState} from 'app/client/models/gristUrlState';
import {IEditableMember, IMemberSelectOption, IOrgMemberSelectOption,
        Resource} from 'app/client/models/UserManagerModel';
import {UserManagerModel, UserManagerModelImpl} from 'app/client/models/UserManagerModel';
import {getResourceParent, ResourceType} from 'app/client/models/UserManagerModel';
import {shadowScroll} from 'app/client/ui/shadowScroll';
import {hoverTooltip, ITooltipControl, showTransientTooltip, withInfoTooltip} from 'app/client/ui/tooltips';
import {createUserImage} from 'app/client/ui/UserImage';
import {cssMemberBtn, cssMemberImage, cssMemberListItem,
        cssMemberPrimary, cssMemberSecondary, cssMemberText, cssMemberType, cssMemberTypeProblem,
        cssRemoveIcon} from 'app/client/ui/UserItem';
import {basicButton, bigBasicButton, bigPrimaryButton} from 'app/client/ui2018/buttons';
import {mediaXSmall, testId, theme, vars} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {cssLink} from 'app/client/ui2018/links';
import {loadingSpinner} from 'app/client/ui2018/loaders';
import {menu, menuItem, menuText} from 'app/client/ui2018/menus';
import {confirmModal, cssAnimatedModal, cssModalBody, cssModalButtons, cssModalTitle,
        IModalControl, modal} from 'app/client/ui2018/modals';

const t = makeT('UserManager');

export interface IUserManagerOptions {
  permissionData: Promise<PermissionData>;
  activeUser: FullUser|null;
  resourceType: ResourceType;
  resourceId: string|number;
  resource?: Resource;
  docPageModel?: DocPageModel;
  appModel?: AppModel;  // If present, we offer access to a nested team-level dialog.
  linkToCopy?: string;
  reload?: () => Promise<PermissionData>;
  onSave?: (personal: boolean) => Promise<unknown>;
  prompt?: {  // If set, user manager should open with this email filled in and ready to go.
    email: string;
  };
  showAnimation?: boolean; // If true, animates opening of the modal. Defaults to false.
}

// Returns an instance of UserManagerModel given IUserManagerOptions. Makes the async call for the
// required properties of the options.
async function getModel(options: IUserManagerOptions): Promise<UserManagerModelImpl> {
  const permissionData = await options.permissionData;
  return new UserManagerModelImpl(
    permissionData, options.resourceType,
    pick(options, ['activeUser', 'reload', 'appModel', 'docPageModel', 'resource'])
  );
}

/**
 * Public interface for creating the UserManager in the app. Creates a modal that includes
 * the UserManager menu with save and cancel buttons.
 */
export function showUserManagerModal(userApi: UserAPI, options: IUserManagerOptions) {
  const modelObs: Observable<UserManagerModel|null|"slow"> = observable(null);

  async function onConfirm(ctl: IModalControl) {
    const model = modelObs.get();
    if (!model || model === "slow") {
      ctl.close();
      return;
    }
    const tryToSaveChanges = async () => {
      // Save changes to the server, reporting any errors to the app.
      try {
        const isAnythingChanged = model.isAnythingChanged.get();
        if (isAnythingChanged) {
          await model.save(userApi, options.resourceId);
        }
        await options.onSave?.(model.isPersonal);
        ctl.close();
        if (model.isPersonal && isAnythingChanged) {
          // the only thing an individual without ACL_EDIT rights can do is
          // remove themselves - so reload.
          window.location.reload();
        }
      } catch (err) {
        reportError(err);
      }
    };
    if (model.isSelfRemoved.get()) {
      const resourceType = resourceName(model.resourceType);
      confirmModal(
        t(`You are about to remove your own access to this {{resourceType}}`, { resourceType }),
        t('Remove my access'), tryToSaveChanges,
        {
          explanation: (
            t(`Once you have removed your own access, \
you will not be able to get it back without assistance \
from someone else with sufficient access to the {{resourceType}}.`, { resourceType })
          ),
        }
      );
    } else {
      tryToSaveChanges().catch(reportError);
    }
  }

  // Get the model and assign it to the observable. Report errors to the app.
  const waitPromise = getModel(options)
    .then(model => modelObs.set(model))
    .catch(reportError);

  isLongerThan(waitPromise, 400).then((slow) => slow && modelObs.set("slow")).catch(() => {});

  return buildUserManagerModal(modelObs, onConfirm, options);
}

function buildUserManagerModal(
  modelObs: Observable<UserManagerModel|null|"slow">,
  onConfirm: (ctl: IModalControl) => Promise<void>,
  options: IUserManagerOptions
) {
  return modal(ctl => [
    // We set the padding to 0 since the body scroll shadows extend to the edge of the modal.
    { style: 'padding: 0;' },
    options.showAnimation ? dom.cls(cssAnimatedModal.className) : null,
    dom.domComputed(modelObs, model => {
      if (!model) { return null; }
      if (model === "slow") { return cssSpinner(loadingSpinner()); }

      const cssBody = model.isPersonal ? cssAccessDetailsBody : cssUserManagerBody;
      return [
        cssTitle(
          renderTitle(options.resourceType, options.resource, model.isPersonal),
          (options.resourceType === 'document' && (!model.isPersonal || model.isPublicMember)
            ? makeCopyBtn(options.linkToCopy, cssCopyBtn.cls('-header'))
            : null
          ),
          testId('um-header'),
        ),
        cssModalBody(
          cssBody(
            new UserManager(
              model,
              pick(options, 'linkToCopy', 'docPageModel', 'appModel', 'prompt', 'resource')
            ).buildDom()
          ),
        ),
        cssModalButtons(
          { style: 'margin: 32px 64px; display: flex;' },
          (model.isPublicMember ? null :
            bigPrimaryButton(t('Confirm'),
              dom.boolAttr('disabled', (use) => !use(model.isAnythingChanged)),
              dom.on('click', () => onConfirm(ctl)),
              testId('um-confirm')
            )
          ),
          bigBasicButton(
            model.isPublicMember ? t('Close') : t('Cancel'),
            dom.on('click', () => ctl.close()),
            testId('um-cancel')
          ),
          (model.resourceType === 'document' && model.gristDoc && !model.isPersonal
            ? withInfoTooltip(
                cssLink({href: urlState().makeUrl({docPage: 'acl'})},
                  dom.text(use => use(model.isAnythingChanged) ? t('Save & ') : ''),
                  t('Open Access Rules'),
                  dom.on('click', (ev) => {
                    ev.preventDefault();
                    return onConfirm(ctl).then(() => urlState().pushUrl({docPage: 'acl'}));
                  }),
                  testId('um-open-access-rules'),
                ),
                'openAccessRules',
                {domArgs: [cssAccessLink.cls('')]},
            )
            : null
          ),
          testId('um-buttons'),
        )
      ];
    })
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
  private _dom: HTMLDivElement;

  constructor(
    private _model: UserManagerModel,
    private _options: {
      linkToCopy?: string,
      docPageModel?: DocPageModel,
      appModel?: AppModel,
      prompt?: {email: string},
      resource?: Resource,
  }) {
    super();
  }

  public buildDom() {
    if (this._model.isPublicMember) {
      return this._buildSelfPublicAccessDom();
    }

    if (this._model.isPersonal) {
      return this._buildSelfAccessDom();
    }

    const acMemberEmail = this.autoDispose(new ACMemberEmail(
      this._onAdd.bind(this),
      this._model.membersEdited.get(),
      this._options.prompt,
    ));

    return [
      acMemberEmail.buildDom(),
      this._buildOptionsDom(),
      this._dom = shadowScroll(
        testId('um-members'),
        this._buildPublicAccessMember(),
        dom.forEach(this._model.membersEdited, (member) => this._buildMemberDom(member)),
      ),
    ];
  }

  private _onAddOrEdit(email: string, role: roles.NonGuestRole) {
    const members = this._model.membersEdited.get();
    const maybeMember = members.find(m => m.email === email);
    if (maybeMember) {
      maybeMember.access.set(role);
    } else {
      this._onAdd(email, role);
    }
  }

  private _onAdd(email: string, role: roles.NonGuestRole) {
    this._model.add(email, role);
    // Make sure the entry we have just added is actually visible - confusing if not.
    Array.from(this._dom.querySelectorAll('.member-email'))
      .find(el => el.textContent === email)
      ?.scrollIntoView();
  }

  private _buildOptionsDom(): Element {
    const publicMember = this._model.publicMember;
    let tooltipControl: ITooltipControl | undefined;
    return dom('div',
      cssOptionRowMultiple(
        icon('AddUser'),
        cssLabel(t('Invite multiple')),
        dom.on('click', (_ev) => buildMultiUserManagerModal(
          this,
          this._model,
          (email, role) => {
            this._onAddOrEdit(email, role);
          },
        ))
      ),
      cssOptionRow(
        // TODO: Consider adding a tooltip explaining inheritance. A brief text caption may
        // be used to fill whitespace in org UserManager.
        this._model.isOrg ? null : dom('span', { style: `float: left;` },
          dom('span', 'Inherit access: '),
          this._inheritRoleSelector()
        ),
        publicMember ? dom('span', { style: `float: right;` },
          cssSmallPublicMemberIcon('PublicFilled'),
          dom('span', t('Public access: ')),
          cssOptionBtn(
            menu(() => {
              tooltipControl?.close();
              return [
                menuItem(() => publicMember.access.set(roles.VIEWER), t('On'), testId(`um-public-option`)),
                menuItem(() => publicMember.access.set(null), t('Off'),
                  // Disable null access if anonymous access is inherited.
                  dom.cls('disabled', (use) => use(publicMember.inheritedAccess) !== null),
                  testId(`um-public-option`)
                ),
                // If the 'Off' setting is disabled, show an explanation.
                dom.maybe((use) => use(publicMember.inheritedAccess) !== null, () => menuText(
                  t(`Public access inherited from {{parent}}. To remove, set 'Inherit access' option to 'None'.`,
                    { parent: getResourceParent(this._model.resourceType) }
                  )))
              ];
            }),
            dom.text((use) => use(publicMember.effectiveAccess) ? t('On') : t('Off')),
            cssCollapseIcon('Collapse'),
            testId('um-public-access')
          ),
          hoverTooltip((ctl) => {
            tooltipControl = ctl;
            return t('Allow anyone with the link to open.');
          }),
        ) : null,
      ),
    );
  }

  // Build a single member row.
  private _buildMemberDom(member: IEditableMember) {
    const disableRemove = Computed.create(null, (use) =>
      this._model.isPersonal ? !member.origAccess :
      Boolean(this._model.isActiveUser(member) || use(member.inheritedAccess)));
    return dom('div',
      dom.autoDispose(disableRemove),
      dom.maybe((use) => use(member.effectiveAccess) && use(member.effectiveAccess) !== roles.GUEST, () =>
        cssMemberListItem(
          cssMemberListItem.cls('-removed', member.isRemoved),
          cssMemberImage(
            createUserImage(getFullUser(member), 'large')
          ),
          cssMemberText(
            cssMemberPrimary(
              member.name || member.email,
              member.email ? dom.cls('member-email') : null,
              testId('um-member-name'),
            ),
            !member.name ? null : cssMemberSecondary(
              member.email, dom.cls('member-email'), testId('um-member-email')
            ),
            (this._model.isPersonal
              ? this._buildSelfAnnotationDom(member)
              : this._buildAnnotationDom(member)
            ),
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

  // Build an annotation for a single member in the Manage Users dialog.
  private _buildAnnotationDom(member: IEditableMember) {
    return dom.domComputed(this._model.annotations, (annotations) => {
      const annotation = annotations.users.get(member.email);
      if (!annotation) { return null; }
      if (annotation.isSupport) {
        return cssMemberType(t('Grist support'));
      }
      if (annotation.isMember && annotations.hasTeam) {
        return cssMemberType(t('Team member'));
      }
      const collaborator = annotations.hasTeam ? t('guest') : t('free collaborator');
      const limit = annotation.collaboratorLimit;
      if (!limit || !limit.top) { return null; }
      const elements: HTMLSpanElement[] = [];
      if (limit.at <= limit.top) {
        elements.push(cssMemberType(
          t(`{{limitAt}} of {{limitTop}} {{collaborator}}s`, { limitAt: limit.at, limitTop: limit.top, collaborator }))
        );
      } else {
        elements.push(cssMemberTypeProblem(
          t(`{{collaborator}} limit exceeded`, { collaborator: capitalizeFirstWord(collaborator) }))
        );
      }
      if (annotations.hasTeam) {
        // Add a link for adding a member. For a doc, streamline this so user can make
        // the change and continue seamlessly.
        // TODO: streamline for workspaces.
        elements.push(cssLink(
          {href: urlState().makeUrl({manageUsers: true})},
          dom.on('click', (e) => {
            if (this._options.appModel) {
              e.preventDefault();
              manageTeam(this._options.appModel,
                         () => this._model.reloadAnnotations(),
                         { email: member.email }).catch(reportError);
            }
          }),
          t(`Add {{member}} to your team`, { member: member.name || t('member') })));
      } else if (limit.at >= limit.top) {
        elements.push(cssLink({href: commonUrls.plans, target: '_blank'},
          t('Create a team to share with more people')));
      }
      return elements;
    });
  }

  // Build an annotation for the current user in the Access Details dialog.
  private _buildSelfAnnotationDom(user: IEditableMember) {
    return dom.domComputed(this._model.annotations, (annotations) => {
      const annotation = annotations.users.get(user.email);
      if (!annotation) { return null; }

      let memberType: string;
      if (annotation.isSupport) {
        memberType = t('Grist support');
      } else if (annotation.isMember && annotations.hasTeam) {
        memberType = t('Team member');
      } else if (annotations.hasTeam) {
        memberType = t('Outside collaborator');
      } else {
        memberType = t('Collaborator');
      }

      return cssMemberType(memberType, testId('um-member-annotation'));
    });
  }

  private _buildPublicAccessMember() {
    const publicMember = this._model.publicMember;
    if (!publicMember) { return null; }
    return dom('div',
      dom.maybe((use) => Boolean(use(publicMember.effectiveAccess)), () =>
        cssMemberListItem(
          cssPublicMemberIcon('PublicFilled'),
          cssMemberText(
            cssMemberPrimary(t('Public Access')),
            cssMemberSecondary(t('Anyone with link '), makeCopyBtn(this._options.linkToCopy)),
          ),
          this._memberRoleSelector(publicMember.effectiveAccess, publicMember.inheritedAccess, false,
            this._model.publicUserSelectOptions
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

  private _buildSelfPublicAccessDom() {
    const accessValue = this._options.resource?.access;
    const accessLabel = this._model.publicUserSelectOptions
      .find(opt => opt.value === accessValue)?.label;
    const activeUser = this._model.activeUser;
    const name = activeUser?.name ?? 'Anonymous';

    return dom('div',
      cssMemberListItem(
        (!activeUser
          ? cssPublicMemberIcon('PublicFilled')
          : cssMemberImage(createUserImage(activeUser, 'large'))
        ),
        cssMemberText(
          cssMemberPrimary(name, testId('um-member-name')),
          activeUser?.email ? cssMemberSecondary(activeUser.email) : null,
          cssMemberPublicAccess(
            dom('span', t('Public access'), testId('um-member-annotation')),
            cssPublicAccessIcon('PublicFilled'),
          ),
        ),
        cssRoleBtn(
          accessLabel ?? t('Guest'),
          cssCollapseIcon('Collapse'),
          dom.cls('disabled'),
          testId('um-member-role'),
        ),
        testId('um-member'),
      ),
      testId('um-members'),
    );
  }

  private _buildSelfAccessDom() {
    return dom('div',
      dom.domComputed(this._model.membersEdited, members =>
        members[0] ? this._buildMemberDom(members[0]) : null
      ),
      testId('um-members'),
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
      // Don't include the menu if we're only showing access details for the current user.
      this._model.isPersonal ? null : menu(() => [
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
        isActiveUser ? menuText(t(`User may not modify their own access.`)) : null,
        // If the user's access is inherited, give an explanation on how to change it.
        dom.maybe((use) => use(inherited) && !isActiveUser, () => menuText(
          t(`User inherits permissions from {{parent}}. To remove, \
set 'Inherit access' option to 'None'.`, { parent: getResourceParent(this._model.resourceType) }))),
        // If the user is a guest, give a description of the guest permission.
        dom.maybe((use) => !this._model.isOrg && use(role) === roles.GUEST, () => menuText(
          t(`User has view access to {{resource}} resulting from manually-set access \
to resources inside. If removed here, this user will lose access to resources inside.`,
            { resource: this._model.resourceType }))),
        this._model.isOrg ? menuText(t(`No default access allows access to be \
granted to individual documents or workspaces, rather than the full team site.`)) : null
      ]),
      dom.text((use) => {
        // Get the label of the active role. Note that the 'Guest' role is assigned when the role
        // is not found because it is not included as a selection.
        const activeRole = allRoles.find((_role: IOrgMemberSelectOption) => use(role) === _role.value);
        return activeRole ? activeRole.label : t("Guest");
      }),
      cssCollapseIcon('Collapse'),
      this._model.isPersonal ? dom.cls('disabled') : null,
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

function getUserItem(member: IEditableMember): ACUserItem {
  return {
    value: member.email,
    label: member.email,
    cleanText: normalizeText(member.email),
    email: member.email,
    name: member.name,
    picture: member?.picture,
    id: member.id,
  };
}

/**
 * Represents the widget that allows typing in an email and adding it.
 */
export class ACMemberEmail extends Disposable {
  private _email = this.autoDispose(observable<string>(""));

  constructor(
    private _onAdd: (email: string, role: roles.NonGuestRole) => void,
    private _members: Array<IEditableMember>,
    private _prompt?: {email: string}
  ) {
    super();
    if (_prompt) {
      this._email.set(_prompt.email);
    }
  }

  public buildDom() {
    const acUserItem = this._members
      // Only suggest team members in autocomplete.
      .filter((member: IEditableMember) => member.isTeamMember)
      .map((member: IEditableMember) => getUserItem(member));
    const acIndex = new ACIndexImpl<ACUserItem>(acUserItem);

    return buildACMemberEmail(this,
      {
        acIndex,
        emailObs: this._email,
        save: this._handleSave.bind(this),
        prompt: this._prompt,
      },
      testId('um-member-new')
    );
  }

  private _handleSave(selectedEmail: string) {
    this._onAdd(selectedEmail, roles.VIEWER);
  }
}

// Returns a new FullUser object from an IEditableMember.
function getFullUser(member: IEditableMember): FullUser {
  return {
    id: member.id,
    name: member.name,
    email: member.email,
    picture: member.picture,
    locale: member.locale
  };
}

// Create a "Copy Link" button.
function makeCopyBtn(linkToCopy: string|undefined, ...domArgs: DomElementArg[]) {
  return linkToCopy && cssCopyBtn(cssCopyIcon('Copy'), t('Copy Link'),
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
  showTransientTooltip(elem, t('Link copied to clipboard'), { key: 'copy-doc-link' });
}

async function manageTeam(appModel: AppModel,
                          onSave?: () => Promise<void>,
                          prompt?: { email: string }) {
  await urlState().pushUrl({manageUsers: false});
  const user = appModel.currentValidUser;
  const currentOrg = appModel.currentOrg;
  if (currentOrg) {
    const api = appModel.api;
    showUserManagerModal(api, {
      permissionData: api.getOrgAccess(currentOrg.id),
      activeUser: user,
      resourceType: 'organization',
      resourceId: currentOrg.id,
      resource: currentOrg,
      onSave,
      prompt,
      showAnimation: true,
    });
  }
}

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

const cssOptionRowMultiple = styled('div', `
  margin: 0 63px 12px 63px;
  font-size: ${vars.mediumFontSize};
  display: flex;
  cursor: pointer;
  color: ${theme.controlFg};
  --icon-color: ${theme.controlFg};

  &:hover {
    color: ${theme.controlHoverFg};
    --icon-color: ${theme.controlHoverFg};
  }
`);

const cssLabel = styled('span', `
  margin-left: 4px;
`);

const cssOptionBtn = styled('span', `
  display: inline-flex;
  font-size: ${vars.mediumFontSize};
  color: ${theme.controlFg};
  cursor: pointer;
`);

const cssPublicMemberIcon = styled(icon, `
  width: 40px;
  height: 40px;
  margin: 0 4px;
  --icon-color: ${theme.accentIcon};
`);

const cssSmallPublicMemberIcon = styled(cssPublicMemberIcon, `
  width: 16px;
  height: 16px;
  top: -2px;
`);

const cssPublicAccessIcon = styled(icon, `
  --icon-color: ${theme.accentIcon};
`);

const cssUndoIcon = styled(icon, `
  --icon-color: ${theme.controlSecondaryFg};
  margin: 12px 0;
`);

const cssRoleBtn = styled('div', `
  display: flex;
  justify-content: flex-end;
  font-size: ${vars.mediumFontSize};
  color: ${theme.controlFg};
  margin: 12px 24px;
  cursor: pointer;

  &.disabled {
    opacity: 0.5;
    cursor: default;
  }
`);

const cssCollapseIcon = styled(icon, `
  margin-top: 1px;
  background-color: ${theme.controlFg};
`);

const cssAccessLink = styled(cssLink, `
  align-self: center;
  margin-left: auto;
`);

const cssOrgName = styled('div', `
  font-size: ${vars.largeFontSize};
`);

const cssOrgDomain = styled('span', `
  color: ${theme.accentText};
`);

const cssTitle = styled(cssModalTitle, `
  margin: 40px 64px 0 64px;

  @media ${mediaXSmall} {
    & {
      margin: 16px;
    }
  }
`);

const cssMemberPublicAccess = styled(cssMemberSecondary, `
  display: flex;
  align-items: center;
  gap: 8px;
`);

// Render the UserManager title for `resourceType` (e.g. org as "team site").
function renderTitle(resourceType: ResourceType, resource?: Resource, personal?: boolean) {
  switch (resourceType) {
    case 'organization': {
      if (personal) { return t('Your role for this team site'); }
      return [
        t('Manage members of team site'),
        !resource ? null : cssOrgName(
          `${(resource as Organization).name} (`,
          cssOrgDomain(`${(resource as Organization).domain}.getgrist.com`),
          ')',
        )
      ];
    }
    default: {
      return personal ?
        t(`Your role for this {{resourceType}}`, { resourceType }) :
        t(`Invite people to {{resourceType}}`, { resourceType });
    }
  }
}

// Rename organization to team site.
function resourceName(resourceType: ResourceType): string {
  return resourceType === 'organization' ? t('team site') : resourceType;
}
