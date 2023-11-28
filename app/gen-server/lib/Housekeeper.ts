import { ApiError } from 'app/common/ApiError';
import { delay } from 'app/common/delay';
import { buildUrlId } from 'app/common/gristUrls';
import { Document } from 'app/gen-server/entity/Document';
import { Organization } from 'app/gen-server/entity/Organization';
import { Workspace } from 'app/gen-server/entity/Workspace';
import { HomeDBManager, Scope } from 'app/gen-server/lib/HomeDBManager';
import { fromNow } from 'app/gen-server/sqlUtils';
import { getAuthorizedUserId } from 'app/server/lib/Authorizer';
import { expressWrap } from 'app/server/lib/expressWrap';
import { GristServer } from 'app/server/lib/GristServer';
import { IElectionStore } from 'app/server/lib/IElectionStore';
import log from 'app/server/lib/log';
import { IPermitStore } from 'app/server/lib/Permit';
import { optStringParam, stringParam } from 'app/server/lib/requestUtils';
import * as express from 'express';
import moment from 'moment';
import fetch from 'node-fetch';
import * as Fetch from 'node-fetch';
import { EntityManager } from 'typeorm';

const DELETE_TRASH_PERIOD_MS = 1 * 60 * 60 * 1000;  // operate every 1 hour
const LOG_METRICS_PERIOD_MS = 24 * 60 * 60 * 1000;  // operate every day
const AGE_THRESHOLD_OFFSET = '-30 days';            // should be an interval known by postgres + sqlite

const SYNC_WORK_LIMIT_MS = 50;      // Don't keep doing synchronous work longer than this.
const SYNC_WORK_BREAK_MS = 50;      // Once reached SYNC_WORK_LIMIT_MS, take a break of this length.

/**
 * Take care of periodic tasks:
 *
 *  - deleting old soft-deleted documents
 *  - deleting old soft-deleted workspaces
 *  - logging metrics
 *
 * Call start(), keep the object around, and call stop() when shutting down.
 *
 * Some care is taken to elect a single server to do the housekeeping, so if there are
 * multiple home servers, there will be no competition or duplication of effort.
 */
export class Housekeeper {
  private _deleteTrashinterval?: NodeJS.Timeout;
  private _logMetricsInterval?: NodeJS.Timeout;
  private _electionKey?: string;
  private _telemetry = this._server.getTelemetry();

  public constructor(private _dbManager: HomeDBManager, private _server: GristServer,
                     private _permitStore: IPermitStore, private _electionStore: IElectionStore) {
  }

  /**
   * Start a ticker to launch housekeeping tasks from time to time.
   */
  public async start() {
    await this.stop();
    this._deleteTrashinterval = setInterval(() => {
      this.deleteTrashExclusively().catch(log.warn.bind(log));
    }, DELETE_TRASH_PERIOD_MS);
    this._logMetricsInterval = setInterval(() => {
      this.logMetricsExclusively().catch(log.warn.bind(log));
    }, LOG_METRICS_PERIOD_MS);
  }

  /**
   * Stop scheduling housekeeping tasks.  Note: doesn't wait for any housekeeping task in progress.
   */
  public async stop() {
    for (const interval of ['_deleteTrashinterval', '_logMetricsInterval'] as const) {
      clearInterval(this[interval]);
      this[interval] = undefined;
    }
  }

  /**
   * Deletes old trash if no other server is working on it or worked on it recently.
   */
  public async deleteTrashExclusively(): Promise<boolean> {
    const electionKey = await this._electionStore.getElection('housekeeping', DELETE_TRASH_PERIOD_MS / 2.0);
    if (!electionKey) {
      log.info('Skipping deleteTrash since another server is working on it or worked on it recently');
      return false;
    }
    this._electionKey = electionKey;
    await this.deleteTrash();
    return true;
  }

  /**
   * Deletes old trash regardless of what other servers may be doing.
   */
  public async deleteTrash() {
    // Delete old soft-deleted docs
    const docs = await this._getDocsToDelete();
    for (const doc of docs) {
      // Last minute check - is the doc really soft-deleted?
      if (doc.removedAt === null && doc.workspace.removedAt === null) {
        throw new Error(`attempted to hard-delete a document that was not soft-deleted: ${doc.id}`);
      }
      // In general, documents can only be manipulated with the coordination of the
      // document worker to which they are assigned.  For an old soft-deleted doc,
      // we could probably get away with ensuring the document is closed/unloaded
      // and then deleting it without ceremony.  But, for consistency, and because
      // it will be useful for other purposes, we work through the api using special
      // temporary permits.
      const permitKey = await this._permitStore.setPermit({docId: doc.id});
      try {
        const result = await fetch(await this._server.getHomeUrlByDocId(doc.id, `/api/docs/${doc.id}`), {
          method: 'DELETE',
          headers: {
            Permit: permitKey
          }
        });
        if (result.status !== 200) {
          log.error(`failed to delete document ${doc.id}: error status ${result.status}`);
        }
      } finally {
        await this._permitStore.removePermit(permitKey);
      }
    }

    // Delete old soft-deleted workspaces
    const workspaces = await this._getWorkspacesToDelete();
    // Note: there's a small chance a workspace could be undeleted right under the wire,
    // and a document added, in which case the method we call here would not yet clean
    // up the docs in s3.  TODO: deal with this.
    for (const workspace of workspaces) {
      // Last minute check - is the workspace really soft-deleted?
      if (workspace.removedAt === null) {
        throw new Error(`attempted to hard-delete a workspace that was not soft-deleted: ${workspace.id}`);
      }
      const scope: Scope = {
        userId: this._dbManager.getPreviewerUserId(),
        specialPermit: {
          workspaceId: workspace.id
        }
      };
      await this._dbManager.deleteWorkspace(scope, workspace.id);
    }

    // Delete old forks
    const forks = await this._getForksToDelete();
    for (const fork of forks) {
      const docId = buildUrlId({trunkId: fork.trunkId!, forkId: fork.id, forkUserId: fork.createdBy!});
      const permitKey = await this._permitStore.setPermit({docId});
      try {
        const result = await fetch(
          await this._server.getHomeUrlByDocId(docId, `/api/docs/${docId}`),
          {
            method: 'DELETE',
            headers: {
              Permit: permitKey,
            },
          }
        );
        if (result.status !== 200) {
          log.error(`failed to delete fork ${docId}: error status ${result.status}`);
        }
      } finally {
        await this._permitStore.removePermit(permitKey);
      }
    }
  }

  /**
   * Logs metrics if no other server is working on it or worked on it recently.
   */
  public async logMetricsExclusively(): Promise<boolean> {
    const electionKey = await this._electionStore.getElection('logMetrics', LOG_METRICS_PERIOD_MS / 2.0);
    if (!electionKey) {
      log.info('Skipping logMetrics since another server is working on it or worked on it recently');
      return false;
    }
    this._electionKey = electionKey;
    await this.logMetrics();
    return true;
  }

  /**
   * Logs metrics regardless of what other servers may be doing.
   */
  public async logMetrics() {
    if (this._telemetry.shouldLogEvent('siteUsage')) {
      log.warn("logMetrics siteUsage starting");
      // Avoid using a transaction since it may end up being held up for a while, and for no good
      // reason (atomicity matters for this reporting).
      const manager = this._dbManager.connection.manager;
      const usageSummaries = await this._getOrgUsageSummaries(manager);

      // We sleep occasionally during this logging. We may log many MANY lines, which can hang up a
      // server for minutes (unclear why; perhaps filling up buffers, and allocating memory very
      // inefficiently?)
      await forEachWithBreaks("logMetrics siteUsage progress", usageSummaries, summary => {
        this._telemetry.logEvent(null, 'siteUsage', {
          limited: {
            siteId: summary.site_id,
            siteType: summary.site_type,
            inGoodStanding: Boolean(summary.in_good_standing),
            numDocs: Number(summary.num_docs),
            numWorkspaces: Number(summary.num_workspaces),
            numMembers: Number(summary.num_members),
            lastActivity: normalizedDateTimeString(summary.last_activity),
            earliestDocCreatedAt: normalizedDateTimeString(summary.earliest_doc_created_at),
          },
          full: {
            stripePlanId: summary.stripe_plan_id,
          },
        });
      });
    }

    if (this._telemetry.shouldLogEvent('siteMembership')) {
      log.warn("logMetrics siteMembership starting");
      const manager = this._dbManager.connection.manager;
      const membershipSummaries = await this._getOrgMembershipSummaries(manager);
      await forEachWithBreaks("logMetrics siteMembership progress", membershipSummaries, summary => {
        this._telemetry.logEvent(null, 'siteMembership', {
          limited: {
            siteId: summary.site_id,
            siteType: summary.site_type,
            numOwners: Number(summary.num_owners),
            numEditors: Number(summary.num_editors),
            numViewers: Number(summary.num_viewers),
          },
        });
      });
    }
  }

  public addEndpoints(app: express.Application) {
    // Allow support user to perform housekeeping tasks for a specific
    // document.  The tasks necessarily bypass user access controls.
    // As such, it would be best if these endpoints not offer ways to
    // read or write the content of a document.

    // Remove unlisted snapshots that are not recorded in inventory.
    // Once all such snapshots have been removed, there should be no
    // further need for this endpoint.
    app.post('/api/housekeeping/docs/:docId/snapshots/clean', this._withSupport(async (_req, docId, headers) => {
      const url = await this._server.getHomeUrlByDocId(docId, `/api/docs/${docId}/snapshots/remove`);
      return fetch(url, {
        method: 'POST',
        body: JSON.stringify({ select: 'unlisted' }),
        headers,
      });
    }));

    // Remove action history from document.  This may be of occasional
    // use, for allowing support to help users looking to purge some
    // information that leaked into document history that they'd
    // prefer not be there, until there's an alternative.
    app.post('/api/housekeeping/docs/:docId/states/remove', this._withSupport(async (_req, docId, headers) => {
      const url = await this._server.getHomeUrlByDocId(docId, `/api/docs/${docId}/states/remove`);
      return fetch(url, {
        method: 'POST',
        body: JSON.stringify({ keep: 1 }),
        headers,
      });
    }));

    // Force a document to reload.  Can be useful during administrative
    // actions.
    app.post('/api/housekeeping/docs/:docId/force-reload', this._withSupport(async (_req, docId, headers) => {
      const url = await this._server.getHomeUrlByDocId(docId, `/api/docs/${docId}/force-reload`);
      return fetch(url, {
        method: 'POST',
        headers,
      });
    }));

    // Move a document to its assigned worker.  Can be useful during administrative
    // actions.
    //
    // Optionally accepts a `group` query param for updating the document's group prior
    // to moving. A blank string unsets the current group, if any. This is useful for controlling
    // which worker group the document is assigned a worker from.
    app.post('/api/housekeeping/docs/:docId/assign', this._withSupport(async (req, docId, headers) => {
      const url = new URL(await this._server.getHomeUrlByDocId(docId, `/api/docs/${docId}/assign`));
      const group = optStringParam(req.query.group, 'group');
      if (group !== undefined) { url.searchParams.set('group', group); }
      return fetch(url.toString(), {
        method: 'POST',
        headers,
      });
    }, 'assign-doc'));
  }

  /**
   * For test purposes, removes any exclusive lock on housekeeping.
   */
  public async testClearExclusivity(): Promise<void> {
    if (this._electionKey) {
      await this._electionStore.removeElection('housekeeping', this._electionKey);
      this._electionKey = undefined;
    }
  }

  private async _getDocsToDelete() {
    const docs = await this._dbManager.connection.createQueryBuilder()
      .select('docs')
      .from(Document, 'docs')
      .leftJoinAndSelect('docs.workspace', 'workspaces')
      .where(`COALESCE(docs.removed_at, workspaces.removed_at) <= ${this._getThreshold()}`)
      // the following has no effect (since null <= date is false) but added for clarity
      .andWhere('COALESCE(docs.removed_at, workspaces.removed_at) IS NOT NULL')
      .getMany();
    return docs;
  }

  private async _getWorkspacesToDelete() {
    const workspaces = await this._dbManager.connection.createQueryBuilder()
      .select('workspaces')
      .from(Workspace, 'workspaces')
      .leftJoin('workspaces.docs', 'docs')
      .where(`workspaces.removed_at <= ${this._getThreshold()}`)
      // the following has no effect (since null <= date is false) but added for clarity
      .andWhere('workspaces.removed_at IS NOT NULL')
      // wait for workspace to be empty
      .andWhere('docs.id IS NULL')
      .getMany();
    return workspaces;
  }

  private async _getForksToDelete() {
    const forks = await this._dbManager.connection.createQueryBuilder()
      .select('forks')
      .from(Document, 'forks')
      .where('forks.trunk_id IS NOT NULL')
      .andWhere(`forks.updated_at <= ${this._getThreshold()}`)
      .getMany();
    return forks;
  }

  private async _getOrgUsageSummaries(manager: EntityManager) {
    const orgs = await manager.createQueryBuilder()
      .select('orgs.id', 'site_id')
      .addSelect('products.name', 'site_type')
      .addSelect('billing_accounts.in_good_standing', 'in_good_standing')
      .addSelect('billing_accounts.stripe_plan_id', 'stripe_plan_id')
      .addSelect('COUNT(DISTINCT docs.id)', 'num_docs')
      .addSelect('COUNT(DISTINCT workspaces.id)', 'num_workspaces')
      .addSelect('COUNT(DISTINCT org_member_users.id)', 'num_members')
      .addSelect('MAX(docs.updated_at)', 'last_activity')
      .addSelect('MIN(docs.created_at)', 'earliest_doc_created_at')
      .from(Organization, 'orgs')
      .leftJoin('orgs.workspaces', 'workspaces')
      .leftJoin('workspaces.docs', 'docs')
      .leftJoin('orgs.billingAccount', 'billing_accounts')
      .leftJoin('billing_accounts.product', 'products')
      .leftJoin('orgs.aclRules', 'acl_rules')
      .leftJoin('acl_rules.group', 'org_groups')
      .leftJoin('org_groups.memberUsers', 'org_member_users')
      .where('org_member_users.id IS NOT NULL')
      .groupBy('orgs.id')
      .addGroupBy('products.id')
      .addGroupBy('billing_accounts.id')
      .getRawMany();
    return orgs;
  }

  private async _getOrgMembershipSummaries(manager: EntityManager) {
    const orgs = await manager.createQueryBuilder()
      .select('orgs.id', 'site_id')
      .addSelect('products.name', 'site_type')
      .addSelect("SUM(CASE WHEN org_groups.name = 'owners' THEN 1 ELSE 0 END)", 'num_owners')
      .addSelect("SUM(CASE WHEN org_groups.name = 'editors' THEN 1 ELSE 0 END)", 'num_editors')
      .addSelect("SUM(CASE WHEN org_groups.name = 'viewers' THEN 1 ELSE 0 END)", 'num_viewers')
      .from(Organization, 'orgs')
      .leftJoin('orgs.billingAccount', 'billing_accounts')
      .leftJoin('billing_accounts.product', 'products')
      .leftJoin('orgs.aclRules', 'acl_rules')
      .leftJoin('acl_rules.group', 'org_groups')
      .leftJoin('org_groups.memberUsers', 'org_member_users')
      .where('org_member_users.id IS NOT NULL')
      .groupBy('orgs.id')
      .addGroupBy('products.id')
      .getRawMany();
    return orgs;
  }

  /**
   * TypeORM isn't very adept at handling date representation for
   * comparisons, so we construct the threshold date in SQL so that we
   * don't have to deal with its caprices.
   */
  private _getThreshold() {
    return fromNow(this._dbManager.connection.driver.options.type, AGE_THRESHOLD_OFFSET);
  }

  // Call a document endpoint with a permit, cleaning up after the call.
  // Checks that the user is the support user.
  private _withSupport(
    callback: (req: express.Request, docId: string, headers: Record<string, string>) => Promise<Fetch.Response>,
    permitAction?: string,
  ): express.RequestHandler {
    return expressWrap(async (req, res) => {
      const userId = getAuthorizedUserId(req);
      if (userId !== this._dbManager.getSupportUserId()) {
        throw new ApiError('access denied', 403);
      }
      const docId = stringParam(req.params.docId, 'docId');
      const permitKey = await this._permitStore.setPermit({docId, action: permitAction});
      try {
        const result = await callback(req, docId, {
          Permit: permitKey,
          'Content-Type': 'application/json',
        });
        res.status(result.status);
        // Return JSON result, or an empty object if no result provided.
        res.json(await result.json().catch(() => ({})));
      } finally {
        await this._permitStore.removePermit(permitKey);
      }
    });
  }
}

/**
 * Output an ISO8601 format datetime string, with timezone.
 * Any string fed in without timezone is expected to be in UTC.
 *
 * When connected to postgres, dates will be extracted as Date objects,
 * with timezone information. The normalization done here is not
 * really needed in this case.
 *
 * Timestamps in SQLite are stored as UTC, and read as strings
 * (without timezone information). The normalization here is
 * pretty important in this case.
 */
function normalizedDateTimeString(dateTime: any): string {
  if (!dateTime) { return dateTime; }
  if (dateTime instanceof Date) {
    return moment(dateTime).toISOString();
  }
  if (typeof dateTime === 'string') {
    // When SQLite returns a string, it will be in UTC.
    // Need to make sure it actually have timezone info in it
    // (will not by default).
    return moment.utc(dateTime).toISOString();
  }
  throw new Error(`normalizedDateTimeString cannot handle ${dateTime}`);
}

/**
 * Call callback(item) for each item on the list, sleeping periodically to allow other works to
 * happen. Any time work takes more than SYNC_WORK_LIMIT_MS, will sleep for SYNC_WORK_BREAK_MS.
 * At each sleep will log a message with logText and progress info.
 */
async function forEachWithBreaks<T>(logText: string, items: T[], callback: (item: T) => void): Promise<void> {
  const delayMs = SYNC_WORK_BREAK_MS;
  const itemsTotal = items.length;
  let itemsProcesssed = 0;
  const start = Date.now();
  let syncWorkStart = start;
  for (const item of items) {
    callback(item);
    itemsProcesssed++;
    if (Date.now() >= syncWorkStart + SYNC_WORK_LIMIT_MS) {
      log.rawInfo(logText, {itemsProcesssed, itemsTotal, delayMs});
      await delay(delayMs);
      syncWorkStart = Date.now();
    }
  }
  log.rawInfo(logText, {itemsProcesssed, itemsTotal, timeMs: Date.now() - start});
}
