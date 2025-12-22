import { VisibleUserProfile } from 'app/common/ActiveDocAPI';
import { CommDocUserPresenceUpdate } from 'app/common/CommTypes';
import * as roles from 'app/common/roles';
import { ANONYMOUS_USER_EMAIL, EVERYONE_EMAIL, FullUser, getRealAccess } from 'app/common/UserAPI';
import { appSettings } from 'app/server/lib/AppSettings';
import { DocClients, isUserPresenceDisabled } from 'app/server/lib/DocClients';
import { DocSession } from 'app/server/lib/DocSession';
import { LogMethods } from 'app/server/lib/LogMethods';

import { fromPairs } from 'lodash';

export class UserPresence {
  private _presenceSessionsById = new Map<string, UserPresenceSession>();

  private _log = new LogMethods('UserPresence ', (s: DocSession | null) => this._activeDoc.getLogMeta(s));

  constructor(private _docClients: DocClients) {
    this._docClients.addClientAddedListener(this._onNewDocSession.bind(this));
    this._docClients.addClientRemovedListener(this._onEndedDocSession.bind(this));
  }

  public async listVisibleUserProfiles(viewingDocSession: DocSession): Promise<VisibleUserProfile[]> {
    if (isUserPresenceDisabled()) { return []; }
    const viewingId = getIdFromDocSession(viewingDocSession);
    const otherPresenceSessions = Array.from(this._presenceSessionsById.values()).filter(
      otherSession => otherSession.id !== viewingId,
    );
    const docUserRoles = await this._getDocUserRoles();
    const userProfiles = otherPresenceSessions.map(
      s => getVisibleUserProfileFromDocSession(s, viewingDocSession, docUserRoles),
    );
    return userProfiles.filter((s?: VisibleUserProfile): s is VisibleUserProfile => s !== undefined);
  }

  private _onNewDocSession(docSession: DocSession) {
    const id = getIdFromDocSession(docSession);
    const _existingPresenceSession = this._presenceSessionsById.get(id);
    if (!_existingPresenceSession) {
      const newPresenceSession = new UserPresenceSession(docSession);
      this._presenceSessionsById.set(id, newPresenceSession);
      this._broadcastUserPresenceSessionUpdate(newPresenceSession);
    }
    else {
      _existingPresenceSession.addDocSession(docSession);
    }
  }

  private _onEndedDocSession(docSession: DocSession) {
    const id = getIdFromDocSession(docSession);
    const _existingPresenceSession = this._presenceSessionsById.get(id);
    if (!_existingPresenceSession) {
      this._log.error(docSession, "No user presence session exists for closing doc session");
      return;
    }

    _existingPresenceSession.removeDocSession(docSession);
    if (_existingPresenceSession.totalDocSessions > 0) { return; }

    this._presenceSessionsById.delete(id);
    this._broadcastUserPresenceSessionRemoval(_existingPresenceSession);
  }

  private _broadcastUserPresenceSessionUpdate(presenceSession: UserPresenceSession) {
    if (isUserPresenceDisabled()) { return; }
    // Loading the doc user roles first allows the callback to be quick + synchronous,
    // avoiding a potentially linear series of async calls.
    this._getDocUserRoles()
      .then(docUserRoles => this._docClients.broadcastDocMessage(
        null,
        "docUserPresenceUpdate",
        undefined,
        async (destSession: DocSession): Promise<CommDocUserPresenceUpdate["data"] | undefined> => {
          if (presenceSession.hasDocSession(destSession)) { return; }
          const profile = getVisibleUserProfileFromDocSession(presenceSession, destSession, docUserRoles);
          if (!profile) { return; }
          return {
            id: presenceSession.publicId,
            profile,
          };
        },
      ))
      .catch((err) => {
        this._log.error(null, "failed to broadcast user presence session update: %s", err);
      });
  }

  private _broadcastUserPresenceSessionRemoval(presenceSession: UserPresenceSession) {
    if (isUserPresenceDisabled()) { return; }
    this._docClients.broadcastDocMessage(
      null,
      "docUserPresenceUpdate",
      undefined,
      async (): Promise<CommDocUserPresenceUpdate["data"] | undefined> => {
        return {
          id: presenceSession.publicId,
          profile: null,
        };
      },
    ).catch((err) => {
      this._log.error(null, "failed to broadcast user presence session removal: %s", err);
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
  userPresenceSession: UserPresenceSession, viewingSession: DocSession, docUserRoles: UserIdRoleMap,
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

  const user = userPresenceSession.user;
  const userId = userPresenceSession.userId;
  const userEmail = user?.loginEmail ?? user?.email;
  const explicitUserRole = userId ? docUserRoles[userId] : null;
  // Only signed-in users that have explicit document access or are a member of the org / workspace
  // have visible details by default.
  const isAnonymous = !explicitUserRole || userEmail === ANONYMOUS_USER_EMAIL || userEmail === EVERYONE_EMAIL;
  return {
    id: userPresenceSession.publicId,
    name: (isAnonymous ? "Anonymous User" : user?.name) || "Unknown User",
    email: isAnonymous ? undefined : user?.email,
    picture: isAnonymous ? undefined : user?.picture,
    isAnonymous,
  };
}

const GRIST_USER_PRESENCE_ICON_PER_TAB = Boolean(appSettings.section('userPresence').flag('iconPerTab').readBool({
  envVar: 'GRIST_USER_PRESENCE_ICON_PER_TAB',
  defaultValue: false,
}));

function getIdFromDocSession(session: DocSession): string {
  // Forces every client to have a unique user presence session. Intended to ease frontend testing.
  if (GRIST_USER_PRESENCE_ICON_PER_TAB) {
    return session.client.publicClientId;
  }
  const authSession = session.client.authSession;
  return (
    (authSession.userIsAuthorized && authSession.userId?.toString()) ||
    authSession.altSessionId ||
    session.client.clientId
  );
}

class UserPresenceSession {
  // Used internally to match doc sessions and presence sessions, should not be sent to the client.
  public readonly id: string;
  public readonly userId: number | null;
  // Unique identifier for this user on the clients.
  public readonly publicId: string;
  public get user() { return this._user; }

  private _docSessions = new Set<DocSession>();
  private _user: FullUser | null;

  constructor(initialSession: DocSession) {
    this.id = getIdFromDocSession(initialSession);
    this.userId = initialSession.client.authSession.userId;
    // Any globally unique value will work, this is convenient.
    this.publicId = initialSession.client.publicClientId;
    this.addDocSession(initialSession);
  }

  public addDocSession(docSession: DocSession): void {
    this._user = docSession.fullUser ?? this.user;
    this._docSessions.add(docSession);
  }

  public removeDocSession(session: DocSession): void {
    this._docSessions.delete(session);
  }

  public get totalDocSessions() {
    return this._docSessions.size;
  }

  public hasDocSession(docSession: DocSession): boolean {
    return this._docSessions.has(docSession);
  }
}
