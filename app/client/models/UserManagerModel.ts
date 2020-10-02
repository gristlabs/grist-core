import {normalizeEmail} from 'app/common/emails';
import {GristLoadConfig} from 'app/common/gristUrls';
import * as roles from 'app/common/roles';
import {ANONYMOUS_USER_EMAIL, EVERYONE_EMAIL, PermissionData, PermissionDelta, UserAPI} from 'app/common/UserAPI';
import {computed, Computed, Disposable, obsArray, ObsArray, observable, Observable} from 'grainjs';
import some = require('lodash/some');

export interface UserManagerModel {
  initData: PermissionData;                    // PermissionData used to initialize the UserManager
  resourceType: ResourceType;                  // String representing the access resource
  userSelectOptions: IMemberSelectOption[];    // Select options for each user's role dropdown
  orgUserSelectOptions: IOrgMemberSelectOption[];  // Select options for each user's role dropdown on the org
  inheritSelectOptions: IMemberSelectOption[]; // Select options for the maxInheritedRole dropdown
  maxInheritedRole: Observable<roles.BasicRole|null>;  // Current unsaved maxInheritedRole setting
  membersEdited: ObsArray<IEditableMember>;    // Current unsaved editable array of members
  publicMember: IEditableMember|null;          // Member whose access (VIEWER or null) represents that of
                                               // anon@ or everyone@ (depending on the settings and resource).
  isAnythingChanged: Computed<boolean>;        // Indicates whether there are unsaved changes
  isOrg: boolean;                              // Indicates if the UserManager is for an org

  // Resets all unsaved changes
  reset(): void;
  // Writes all unsaved changes to the server.
  save(userApi: UserAPI, resourceId: number|string): Promise<void>;
  // Adds a member to membersEdited
  add(email: string, role: roles.Role|null): void;
  // Removes a member from membersEdited
  remove(member: IEditableMember): void;
  // Returns a boolean indicating if the member is the currently active user.
  isActiveUser(member: IEditableMember): boolean;
  // Returns the PermissionDelta reflecting the current unsaved changes in the model.
  getDelta(): PermissionDelta;
}

export type ResourceType = 'organization'|'workspace'|'document';

export interface IEditableMember {
  id: number;    // Newly invited members do not have ids and are represented by -1
  name: string;
  email: string;
  picture?: string|null;
  access: Observable<roles.Role|null>;
  parentAccess: roles.BasicRole|null;
  inheritedAccess: Computed<roles.BasicRole|null>;
  effectiveAccess: Computed<roles.Role|null>;
  origAccess: roles.Role|null;
  isNew: boolean;
  isRemoved: boolean;
}

// An option for the select elements used in the UserManager.
export interface IMemberSelectOption {
  value: roles.BasicRole|null;
  label: string;
}

// An option for the organization select elements used in the UserManager.
export interface IOrgMemberSelectOption {
  value: roles.NonGuestRole|null;
  label: string;
}

interface IBuildMemberOptions {
  id: number;
  name: string;
  email: string;
  picture?: string|null;
  access: roles.Role|null;
  parentAccess: roles.BasicRole|null;
}

/**
 *
 */
export class UserManagerModelImpl extends Disposable implements UserManagerModel {
  // Select options for each individual user's role dropdown.
  public readonly userSelectOptions: IMemberSelectOption[] = [
    { value: roles.OWNER,  label: 'Owner'  },
    { value: roles.EDITOR, label: 'Editor' },
    { value: roles.VIEWER, label: 'Viewer' }
  ];
  // Select options for each individual user's role dropdown in the org.
  public readonly orgUserSelectOptions: IOrgMemberSelectOption[] = [
    { value: roles.OWNER,  label: 'Owner'  },
    { value: roles.EDITOR, label: 'Editor' },
    { value: roles.VIEWER, label: 'Viewer' },
    { value: roles.MEMBER, label: 'No Default Access' },
  ];
  // Select options for the resource's maxInheritedRole dropdown.
  public readonly inheritSelectOptions: IMemberSelectOption[] = [
    { value: roles.OWNER,  label: 'In Full'     },
    { value: roles.EDITOR, label: 'View & Edit' },
    { value: roles.VIEWER, label: 'View Only'   },
    { value: null,         label: 'None'        }
  ];

  public maxInheritedRole: Observable<roles.BasicRole|null> =
    observable(this.initData.maxInheritedRole || null);

  // The public member's access settings reflect either those of anonymous users (when
  // shouldSupportAnon() is true) or those of everyone@ (i.e. access granted to all users,
  // supported for docs only). The member is null when public access is not supported.
  public publicMember: IEditableMember|null = this._buildPublicMember();

  public membersEdited = this.autoDispose(obsArray<IEditableMember>(this._buildAllMembers()));

  public isOrg: boolean = this.resourceType === 'organization';

  // Checks if any members were added/removed/changed, if the max inherited role changed or if the
  // anonymous access setting changed to enable the confirm button to write changes to the server.
  public readonly isAnythingChanged: Computed<boolean> = this.autoDispose(computed<boolean>((use) => {
    const isMemberChangedFn = (m: IEditableMember) => m.isNew || m.isRemoved ||
      use(m.access) !== m.origAccess;
    const isInheritanceChanged = !this.isOrg && use(this.maxInheritedRole) !== this.initData.maxInheritedRole;
    return some(use(this.membersEdited), isMemberChangedFn) || isInheritanceChanged ||
      (this.publicMember ? isMemberChangedFn(this.publicMember) : false);
  }));

  constructor(
    public initData: PermissionData,
    public resourceType: ResourceType,
    private _activeUserEmail: string|null
  ) {
    super();
  }

  public reset(): void {
    this.membersEdited.set(this._buildAllMembers());
  }

  public async save(userApi: UserAPI, resourceId: number|string): Promise<void> {
    if (this.resourceType === 'organization') {
      await userApi.updateOrgPermissions(resourceId as number, this.getDelta());
    } else if (this.resourceType === 'workspace') {
      await userApi.updateWorkspacePermissions(resourceId as number, this.getDelta());
    } else if (this.resourceType === 'document') {
      await userApi.updateDocPermissions(resourceId as string, this.getDelta());
    }
  }

  public add(email: string, role: roles.Role|null): void {
    email = normalizeEmail(email);
    const members = this.membersEdited.get();
    const index = members.findIndex((m) => m.email === email);
    const existing = index > -1 ? members[index] : null;
    if (existing && existing.isRemoved) {
      // The member is replaced with the isRemoved set to false to trigger an
      // update to the membersEdited observable array.
      this.membersEdited.splice(index, 1, {...existing, isRemoved: false});
    } else if (existing) {
      const effective = existing.effectiveAccess.get();
      if (effective && effective !== roles.GUEST) {
        // If the member is visible, throw to inform the user.
        throw new Error("This user is already in the list");
      }
      // If the member exists but is not visible, update their access to make them visible.
      // They should be treated as a new user - removing them should make them invisible again.
      existing.access.set(role);
      existing.isNew = true;
    } else {
      const newMember = this._buildEditableMember({
        id: -1, // Use a placeholder for the unknown userId
        email,
        name: "",
        access: role,
        parentAccess: null
      });
      newMember.isNew = true;
      this.membersEdited.push(newMember);
    }
  }

  public remove(member: IEditableMember): void {
    const index = this.membersEdited.get().indexOf(member);
    if (member.isNew) {
      this.membersEdited.splice(index, 1);
    } else {
      // Keep it in the array with a flag, to simplify comparing "before" and "after" arrays.
      this.membersEdited.splice(index, 1, {...member, isRemoved: true});
    }
  }

  public isActiveUser(member: IEditableMember): boolean {
    return member.email === this._activeUserEmail;
  }

  public getDelta(): PermissionDelta {
    // Construct the permission delta from the changed users/maxInheritedRole.
    const delta: PermissionDelta = { users: {} };
    if (this.resourceType !== 'organization') {
      const maxInheritedRole = this.maxInheritedRole.get();
      if (this.initData.maxInheritedRole !== maxInheritedRole) {
        delta.maxInheritedRole = maxInheritedRole;
      }
    }
    // Looping through the members has the side effect of updating the delta.
    const members = [...this.membersEdited.get()];
    if (this.publicMember) {
      members.push(this.publicMember);
    }
    members.forEach((m, i) => {
      const access = m.access.get();
      if (!roles.isValidRole(access)) {
        throw new Error(`Cannot update user to invalid role ${access}`);
      }
      if (m.isNew || m.isRemoved || m.origAccess !== access) {
        // Add users whose access changed.
        delta.users![m.email] = m.isRemoved ? null : access as roles.NonGuestRole;
      }
    });
    return delta;
  }

  private _buildAllMembers(): IEditableMember[] {
    // If the UI supports some public access, strip the supported public user (anon@ or
    // everyone@). Otherwise, keep it, to allow the non-fancy way of adding/removing public access.
    let users = this.initData.users;
    const publicMember = this.publicMember;
    if (publicMember) {
      users = users.filter(m => m.email !== publicMember.email);
    }
    return users.map(m =>
      this._buildEditableMember({
        id: m.id,
        email: m.email,
        name: m.name,
        picture: m.picture,
        access: m.access,
        parentAccess: m.parentAccess || null,
      })
    );
  }

  private _buildPublicMember(): IEditableMember|null {
    // shouldSupportAnon() changes "public" access to "anonymous" access, and enables it for
    // workspaces and org level. It's currently used for on-premise installs only.
    // TODO Think through proper public sharing or workspaces/orgs, and get rid of
    // shouldSupportAnon() exceptions.
    const email =
      shouldSupportAnon() ? ANONYMOUS_USER_EMAIL :
      (this.resourceType === 'document') ? EVERYONE_EMAIL : null;
    if (!email) { return null; }
    const user = this.initData.users.find(m => m.email === email);
    return this._buildEditableMember({
      id: user ? user.id : -1,
      email,
      name: "",
      access: user ? user.access : null,
      parentAccess: user ? (user.parentAccess || null) : null,
    });
  }

  private _buildEditableMember(member: IBuildMemberOptions): IEditableMember {
    // Represents the member's access set specifically on the resource of interest.
    const access = Observable.create(this, member.access);
    let inheritedAccess: Computed<roles.BasicRole|null>;

    if (member.email === this._activeUserEmail) {
      // Note that we currently prevent the active user's role from changing to prevent users from
      // locking themselves out of resources. We ensure that by setting inheritedAccess to the
      // active user's initial access level, which is OWNER normally. (It's sometimes possible to
      // open UserManager by a less-privileged user, e.g. if access was just lowered, in which
      // case any attempted changes will fail on saving.)
      const initInheritedAccess = roles.getWeakestRole(member.parentAccess, this.initData.maxInheritedRole || null);
      const initialAccess = roles.getStrongestRole(member.access, initInheritedAccess);
      const initialAccessBasicRole = roles.getEffectiveRole(initialAccess);
      // This pretends to be a computed to match the other case, but is really a constant.
      inheritedAccess = Computed.create(this, (use) => initialAccessBasicRole);
    } else {
      // Gives the role inherited from parent taking the maxInheritedRole into account.
      inheritedAccess = Computed.create(this, this.maxInheritedRole, (use, maxInherited) =>
        roles.getWeakestRole(member.parentAccess, maxInherited));
    }
    // Gives the effective role of the member on the resource, taking everything into account.
    const effectiveAccess = Computed.create(this, (use) =>
      roles.getStrongestRole(use(access), use(inheritedAccess)));
    effectiveAccess.onWrite((value) => {
      // For UI simplicity, we use a single dropdown to represent the effective access level of
      // the user AND to allow changing it. As a result, we do NOT allow using the dropdown to
      // write/show values that provide less direct access than what the user already inherits.
      // It is confusing to show and results in no change in the effective access.
      const inherited = inheritedAccess.get();
      const isAboveInherit = roles.getStrongestRole(value, inherited) !== inherited;
      access.set(isAboveInherit ? value : null);
    });
    return {
      id: member.id,
      email: member.email,
      name: member.name,
      picture: member.picture,
      access,
      parentAccess: member.parentAccess || null,
      inheritedAccess,
      effectiveAccess,
      origAccess: member.access,
      isNew: false,
      isRemoved: false,
    };
  }
}

export function getResourceParent(resource: ResourceType): ResourceType|null {
  if (resource === 'workspace') {
    return 'organization';
  } else if (resource === 'document') {
    return 'workspace';
  } else {
    return null;
  }
}

// Check whether anon should be supported in the UI
export function shouldSupportAnon(): boolean {
  const gristConfig: GristLoadConfig = (window as any).gristConfig || {};
  return gristConfig.supportAnon || false;
}
