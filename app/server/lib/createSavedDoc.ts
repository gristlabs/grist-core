import { ApiError } from "app/common/ApiError";
import { localeCompare } from "app/common/gutil";
import { HomeDBManager } from "app/gen-server/lib/homedb/HomeDBManager";
import { Permissions } from "app/gen-server/lib/Permissions";
import { getTransitiveHeaders, getUserId } from "app/server/lib/Authorizer";
import { GristServer } from "app/server/lib/GristServer";
import { getScope } from "app/server/lib/requestUtils";

import * as express from "express";

/**
 * Creates a new document in a workspace.
 *
 * If `options.workspaceId` is specified, the document will be created there.
 * Otherwise, the workspace is chosen automatically, and is the first workspace
 * in alphabetical order that's owned by the user on their personal site,
 * mirroring the behavior of creating a document in the client.
 *
 * If `options.srcDocId` is specified, the created document will be a copy
 * of that document. Otherwise, a blank document will be created.
 */
export async function createSavedDoc(
  server: GristServer,
  req: express.Request,
  options: { srcDocId?: string; workspaceId?: number } = {},
): Promise<string> {
  const { srcDocId, workspaceId } = options;
  const dbManager = server.getHomeDBManager();
  const userId = getUserId(req);
  const doc = srcDocId ?
    await dbManager.getDoc({ userId, urlId: srcDocId }) :
    undefined;
  if (srcDocId && !doc) {
    throw new ApiError(`Doc ${srcDocId} not found`, 400);
  }

  const workspace = workspaceId === undefined ?
    await getFirstPersonalWorkspace(dbManager, req, userId) :
    await getWritableWorkspace(dbManager, req, workspaceId);

  const createDocUrl = server.getHomeInternalUrl("/api/docs");
  const response = await fetch(createDocUrl, {
    headers: {
      ...getTransitiveHeaders(req, { includeOrigin: false }),
      "Content-Type": "application/json",
    },
    method: "POST",
    body: JSON.stringify({
      sourceDocumentId: doc?.id,
      workspaceId: workspace.id,
      documentName: doc?.name,
    }),
  });
  const body = await response.json();
  if (!response.ok) {
    throw new ApiError(
      `Unable to create document in workspace ${workspace.name}`,
      response.status,
      body,
    );
  }

  return body;
}

async function getWritableWorkspace(
  dbManager: HomeDBManager,
  req: express.Request,
  workspaceId: number,
) {
  return dbManager.unwrapQueryResult(
    await dbManager.getWorkspace(getScope(req), workspaceId, undefined, {
      requirePermissions: Permissions.ADD,
    }),
  );
}

async function getFirstPersonalWorkspace(
  dbManager: HomeDBManager,
  req: express.Request,
  userId: number,
) {
  const workspacesQueryResult = await dbManager.getOrgWorkspaces(
    getScope(req),
    0,
  );
  const workspaces = dbManager.unwrapQueryResult(workspacesQueryResult);
  const userWorkspaces = workspaces
    .filter(w => !w.isSupportWorkspace && w.owner?.id === userId)
    .sort((a, b) => localeCompare(a.name, b.name));
  if (userWorkspaces.length === 0) {
    throw new ApiError(
      `User ${userId} has no workspaces in their personal site`,
      500,
    );
  }
  return userWorkspaces[0];
}
