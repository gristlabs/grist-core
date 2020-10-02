/**
 * Helpers needed for showing the title of a workspace.
 */
import {AppModel} from 'app/client/models/AppModel';
import {FullUser} from 'app/common/LoginSessionAPI';
import {Workspace} from 'app/common/UserAPI';

// Render the name of a workspace.  There is a similar method in HomeLeftPane.
// Not merging since the styling of parts of the name may need to diverge.
export function workspaceName(app: AppModel, ws: Workspace) {
  const {owner, name} = getWorkspaceInfo(app, ws);
  return [name, owner ? `@${owner.name}` : ''].join(' ').trim();
}

// Get the name of the personal owner of a workspace, if it is set
// and distinct from the current user.  If the personal owner is not
// set, or is the same as the current user, the empty string is
// returned.  The personal owner will only be set for workspaces in
// the "docs" pseudo-organization, which is assembled from all the
// personal organizations the current user has access to.
export function ownerName(app: AppModel, ws: Workspace): string {
  const {owner, self} = getWorkspaceInfo(app, ws);
  return self ? '' : (owner ? owner.name : '');
}

// Information needed for showing the title of a workspace.
export interface WorkspaceInfo {
  name: string;      // user-specified workspace name (empty if should not be shown)
  owner?: FullUser;  // personal owner of workspace (if known and should be shown)
  self?: boolean;    // set if owner is current user
  isDefault?: boolean;  // set if workspace is current user's 'Home' workspace
}

// Get information needed for showing the title of a workspace.
export function getWorkspaceInfo(app: AppModel, ws: Workspace): WorkspaceInfo {
  const user = app.currentUser;
  const {name, owner} = ws;
  const isHome = name === 'Home';
  if (!user || !owner) { return {owner, name}; }
  const self = user.id === owner.id;
  const isDefault = self && isHome;
  if (ws.isSupportWorkspace) {
    // Keep workspace name for support workspaces; drop owner name.
    return {name, self, isDefault};
  }
  if (isHome && !isDefault) {
    // "Home" workspaces of other users have their names omitted, but we retain
    // the name "Home" for the current user's "Home" workspace.
    return {name: '', owner, self, isDefault};  // omit name in this case
  }
  if (self) {
    return {name, self, isDefault};
  }
  return {name, owner, self, isDefault};
}
