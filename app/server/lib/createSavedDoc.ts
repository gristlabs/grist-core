import { localeCompare } from "app/common/gutil";
import { getTransitiveHeaders, getUserId } from "app/server/lib/Authorizer";
import { GristServer } from "app/server/lib/GristServer";
import { getScope } from "app/server/lib/requestUtils";
import * as express from "express";

/**
 * Creates a new document in a workspace on the user's personal site.
 *
 * The workspace is chosen automatically, and is the first workspace
 * in alphabetical order that's owned by the user, mirroring the behavior
 * of creating a document in the client.
 *
 * If `options.srcDocId` is specified, the created document will be a copy
 * of that document. Otherwise, a blank document will be created.
 */
export async function createSavedDoc(
  server: GristServer,
  req: express.Request,
  options: { srcDocId?: string } = {}
): Promise<string> {
  const { srcDocId } = options;
  const dbManager = server.getHomeDBManager();
  const userId = getUserId(req);
  const doc = srcDocId
    ? await dbManager.getDoc({ userId, urlId: srcDocId })
    : undefined;
  if (srcDocId && !doc) {
    throw new Error(`Doc ${srcDocId} not found`);
  }

  const workspacesQueryResult = await dbManager.getOrgWorkspaces(
    getScope(req),
    0
  );
  const workspaces = dbManager.unwrapQueryResult(workspacesQueryResult);
  const userWorkspaces = workspaces
    .filter((w) => !w.isSupportWorkspace)
    .sort((a, b) => localeCompare(a.name, b.name));
  if (userWorkspaces.length === 0) {
    throw new Error(`User ${userId} has no workspaces in their personal site`);
  }

  const createDocUrl = server.getHomeInternalUrl("/api/docs");
  const response = await fetch(createDocUrl, {
    headers: {
      ...getTransitiveHeaders(req, { includeOrigin: false }),
      "Content-Type": "application/json",
    },
    method: "POST",
    body: JSON.stringify({
      sourceDocumentId: doc?.id,
      workspaceId: userWorkspaces[0].id,
      documentName: doc?.name,
    }),
  });
  return await response.json();
}
