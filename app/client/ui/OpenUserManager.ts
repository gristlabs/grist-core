import {loadUserManager} from 'app/client/lib/imports';
import {AppModel} from 'app/client/models/AppModel';
import {FullUser, Organization, UserAPI} from 'app/common/UserAPI';

export interface ManageTeamUsersOptions {
  org: Organization;
  user: FullUser | null;
  api: UserAPI;
  onSave?: (personal: boolean) => Promise<unknown>;
}

// Opens the user-manager for the given org.
export async function manageTeamUsers({org, user, api, onSave}: ManageTeamUsersOptions) {
  (await loadUserManager()).showUserManagerModal(api, {
    permissionData: api.getOrgAccess(org.id),
    activeUser: user,
    resourceType: 'organization',
    resourceId: org.id,
    resource: org,
    onSave
  });
}

export interface ManagePersonalUsersAppOptions {
  app: AppModel;
  onSave?: (personal: boolean) => Promise<unknown>;
}

// Opens the user-manager for the current org in the given AppModel.
export async function manageTeamUsersApp({app, onSave}: ManagePersonalUsersAppOptions) {
  if (app.currentOrg) {
    return manageTeamUsers({org: app.currentOrg, user: app.currentValidUser, api: app.api, onSave});
  }
}
