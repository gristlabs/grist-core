import {loadUserManager} from 'app/client/lib/imports';
import {AppModel} from 'app/client/models/AppModel';
import {FullUser, Organization, UserAPI} from 'app/common/UserAPI';

// Opens the user-manager for the given org.
export async function manageTeamUsers(org: Organization, user: FullUser|null, api: UserAPI) {
  (await loadUserManager()).showUserManagerModal(api, {
    permissionData: api.getOrgAccess(org.id),
    activeUser: user,
    resourceType: 'organization',
    resourceId: org.id,
    resource: org,
  });
}

// Opens the user-manager for the current org in the given AppModel.
export async function manageTeamUsersApp(app: AppModel) {
  if (app.currentOrg) {
    return manageTeamUsers(app.currentOrg, app.currentValidUser, app.api);
  }
}
