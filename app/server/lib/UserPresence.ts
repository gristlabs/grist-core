import {VisibleUserProfile} from 'app/common/ActiveDocAPI';
import {CommDocUserPresenceUpdate} from 'app/common/CommTypes';
import * as roles from 'app/common/roles';
import {getRealAccess} from 'app/common/UserAPI';
import {DocClients, isUserPresenceDisabled} from 'app/server/lib/DocClients';
import {DocSession} from 'app/server/lib/DocSession';
import {LogMethods} from 'app/server/lib/LogMethods';

import {fromPairs} from 'lodash';

export class UserPresence {
  private _log = new LogMethods('UserPresence ', (s: DocSession|null) => this._activeDoc.getLogMeta(s));

  constructor(private _docClients: DocClients) {
    this._docClients.addClientAddedListener(this._broadcastUserPresenceSessionUpdate.bind(this));
    this._docClients.addClientRemovedListener(this._broadcastUserPresenceSessionRemoval.bind(this));
  }

  public async listVisibleUserProfiles(viewingDocSession: DocSession): Promise<VisibleUserProfile[]> {
    if (isUserPresenceDisabled()) { return []; }
    const otherDocSessions =
      this._docClients.listClients().filter(s => s.client.clientId !== viewingDocSession.client.clientId);
    const docUserRoles = await this._getDocUserRoles();
    const userProfiles = otherDocSessions.map(
      s => getVisibleUserProfileFromDocSession(s, viewingDocSession, docUserRoles)
    );
    return userProfiles.filter((s?: VisibleUserProfile): s is VisibleUserProfile => s !== undefined);
  }

  private _broadcastUserPresenceSessionUpdate(originSession: DocSession) {
    if (isUserPresenceDisabled()) { return; }
    // Loading the doc user roles first allows the callback to be quick + synchronous,
    // avoiding a potentially linear series of async calls.
    this._getDocUserRoles()
      .then(docUserRoles => this._docClients.broadcastDocMessage(
        originSession.client,
        "docUserPresenceUpdate",
        undefined,
        async (destSession: DocSession): Promise<CommDocUserPresenceUpdate["data"] | undefined> => {
          if (originSession === destSession) { return; }
          const profile = getVisibleUserProfileFromDocSession(originSession, destSession, docUserRoles);
          if (!profile) { return; }
          return {
            id: getVisibleUserProfileId(originSession),
            profile
          };
        }
      ))
      .catch(err => {
        this._log.error(originSession, "failed to broadcast user presence session update: %s", err);
      });
  }

  private _broadcastUserPresenceSessionRemoval(originSession: DocSession) {
    if (isUserPresenceDisabled()) { return; }
    this._docClients.broadcastDocMessage(
      originSession.client,
      "docUserPresenceUpdate",
      undefined,
      async (): Promise<CommDocUserPresenceUpdate["data"] | undefined> => {
        return {
          id: getVisibleUserProfileId(originSession),
          profile: null,
        };
      }
    ).catch(err => {
      this._log.error(originSession, "failed to broadcast user presence session removal: %s", err);
    });
  }

  private async _getDocUserRoles(): Promise<UserIdRoleMap> {
    const homeDb = this._activeDoc.getHomeDbManager();
    const authCache = homeDb?.caches;
    const docId = this._activeDoc.doc?.id;

    // Not enough information - no useful data to be had here.
    if (!homeDb || !docId || !authCache) {
      return {};
    }

    const queryResult = await authCache.getDocAccess(docId);
    const { users, maxInheritedRole } = homeDb.unwrapQueryResult(queryResult);

    return fromPairs(users.map(user => [user.id, getRealAccess(user, { maxInheritedRole })]));
  }

  private get _activeDoc() {
    return this._docClients.activeDoc;
  }
}


interface UserIdRoleMap {
  [id: string]: roles.Role | null
}

function getVisibleUserProfileFromDocSession(
  session: DocSession, viewingSession: DocSession, docUserRoles: UserIdRoleMap,
): VisibleUserProfile | undefined {
  // To see other users, you need to be a non-public user (i.e. added to the document), and have
  // at least editor permissions.
  if (!viewingSession.client.authSession.userId) {
    return undefined;
  }

  const viewerRole = docUserRoles[viewingSession.client.authSession.userId];
  if (!roles.canEdit(viewerRole)) {
    return undefined;
  }

  const user = session.client.authSession.fullUser;
  const userId = session.client.authSession.userId;
  const explicitUserRole = userId ? docUserRoles[userId] : null;
  // Only signed-in users that have explicit document access or are a member of the org / workspace
  // have visible details by default.
  const isAnonymous = !explicitUserRole;
  return {
    id: getVisibleUserProfileId(session),
    name: (isAnonymous ? "Anonymous User" : user?.name) || "Unknown User",
    picture: isAnonymous ? undefined : user?.picture,
    isAnonymous,
  };
}

function getVisibleUserProfileId(session: DocSession): string {
  return session.client.publicClientId;
}
