import { ApiError } from 'app/common/ApiError';
import { FullUser } from 'app/common/UserAPI';
import { Organization } from 'app/gen-server/entity/Organization';
import { HomeDBManager, Scope } from 'app/gen-server/lib/HomeDBManager';
import { INotifier } from 'app/server/lib/INotifier';
import { scrubUserFromOrg } from 'app/gen-server/lib/scrubUserFromOrg';
import { GristLoginSystem } from 'app/server/lib/GristServer';
import { IPermitStore } from 'app/server/lib/Permit';
import remove = require('lodash/remove');
import sortBy = require('lodash/sortBy');
import fetch from 'node-fetch';

/**
 *
 * This is a tool that specializes in deletion of resources.  Deletion needs some
 * coordination between multiple services.
 *
 */
export class Doom {
  constructor(private _dbManager: HomeDBManager, private _permitStore: IPermitStore,
              private _notifier: INotifier, private _loginSystem: GristLoginSystem,
              private _homeApiUrl: string) {
  }

  /**
   * Deletes a team site.
   *   - Remove billing (fails if there is an outstanding balance).
   *   - Delete workspaces.
   *   - Delete org.
   */
  public async deleteOrg(orgKey: number) {
    await this._removeBillingFromOrg(orgKey);
    const workspaces = await this._getWorkspaces(orgKey);
    for (const workspace of workspaces) {
      await this.deleteWorkspace(workspace.id);
    }
    const finalWorkspaces = await this._getWorkspaces(orgKey);
    if (finalWorkspaces.length > 0) {
      throw new ApiError(`Failed to remove all workspaces from org ${orgKey}`, 500);
    }
    // There is a window here in which user could put back docs, would be nice to close it.
    const scope: Scope = {
      userId: this._dbManager.getPreviewerUserId(),
      specialPermit: {
        org: orgKey
      }
    };
    await this._dbManager.deleteOrg(scope, orgKey);
  }

  /**
   * Deletes a workspace after bloody-mindedly deleting its documents one by one.
   * Fails if any document is not successfully deleted.
   */
  public async deleteWorkspace(workspaceId: number) {
    const workspace = await this._getWorkspace(workspaceId);
    for (const doc of workspace.docs) {
      const permitKey = await this._permitStore.setPermit({docId: doc.id});
      try {
        const docApiUrl = this._homeApiUrl + `/api/docs/${doc.id}`;
        const result = await fetch(docApiUrl, {
          method: 'DELETE',
          headers: {
            Permit: permitKey
          }
        });
        if (result.status !== 200) {
          const info = await result.json().catch(e => null);
          throw new ApiError(`failed to delete document ${doc.id}: ${result.status} ${JSON.stringify(info)}`, 500);
        }
      } finally {
        await this._permitStore.removePermit(permitKey);
      }
    }
    const finalWorkspace = await this._getWorkspace(workspaceId);
    if (finalWorkspace.docs.length > 0) {
      throw new ApiError(`Failed to remove all documents from workspace ${workspaceId}`, 500);
    }
    // There is a window here in which user could put back docs.
    const scope: Scope = {
      userId: this._dbManager.getPreviewerUserId(),
      specialPermit: {
        workspaceId: workspace.id
      }
    };
    await this._dbManager.deleteWorkspace(scope, workspaceId);
  }

  /**
   * Delete a user.
   */
  public async deleteUser(userId: number) {
    const user = await this._dbManager.getUser(userId);
    if (!user) { throw new Error(`user not found: ${userId}`); }

    // Don't try scrubbing users from orgs just yet, leave this to be done manually.
    // Automatic scrubbing could do with a solid test set before being used.
    /**
    // Need to scrub the user from any org they are in, except their own personal org.
    let orgs = await this._getOrgs(userId);
    for (const org of orgs) {
      if (org.ownerId !== userId) {
        await this.deleteUserFromOrg(userId, org);
      }
    }
    */
    let orgs = await this._getOrgs(userId);
    if (orgs.length === 1 && orgs[0].ownerId === userId) {
      await this.deleteOrg(orgs[0].id);
      orgs = await this._getOrgs(userId);
    }
    if (orgs.length > 0) {
      throw new ApiError('Cannot remove user from a site', 500);
    }

    // Remove user from sendgrid
    await this._notifier.deleteUser(userId);

    // Remove user from cognito
    await this._loginSystem.deleteUser(user);

    // Remove user from our db
    await this._dbManager.deleteUser({userId}, userId);
  }

  /**
   * Disentangle a user from a specific site. Everything a user has access to will be
   * passed to another owner user. If there is no owner available, the call will fail -
   * you'll need to explicitly delete the site. Owners who are billing managers are
   * preferred. If there are multiple owners who are billing managers, the choice is
   * made arbitrarily (alphabetically by email).
   */
  public async deleteUserFromOrg(userId: number, org: Organization) {
    const orgId = org.id;
    const scope = {userId: this._dbManager.getPreviewerUserId()};
    const members = this._dbManager.unwrapQueryResult(await this._dbManager.getOrgAccess(scope, orgId));
    const owners: FullUser[] = members.users
      .filter(u => u.access === 'owners' && u.id !== userId);
    if (owners.length === 0) {
      throw new ApiError(`No owner available for ${org.id}/${org.domain}/${org.name}`, 401);
    }
    if (owners.length > 1) {
      const billing = await this._dbManager.getBillingAccount(scope, orgId, true);
      const billingManagers = billing.managers.map(manager => manager.user)
        .filter(u => u.id !== userId)
        .map(u => this._dbManager.makeFullUser(u));
      const billingManagerSet = new Set(billingManagers.map(bm => bm.id));
      const nonBillingManagers = remove(owners, owner => !billingManagerSet.has(owner.id));
      if (owners.length === 0) {
        // Darn, no owners were billing-managers - so put them all back into consideration.
        owners.push(...nonBillingManagers);
      }
    }
    const candidate = sortBy(owners, ['email'])[0];
    await scrubUserFromOrg(orgId, userId, candidate.id, this._dbManager.connection.manager);
  }

  // List the sites a user has access to.
  private async _getOrgs(userId: number) {
    const orgs = this._dbManager.unwrapQueryResult(await this._dbManager.getOrgs(userId, null,
                                                                                 {ignoreEveryoneShares: true}));
    return orgs;
  }

  // Get information about a workspace, including the docs in it.
  private async _getWorkspace(workspaceId: number) {
    const workspace = this._dbManager.unwrapQueryResult(
      await this._dbManager.getWorkspace({userId: this._dbManager.getPreviewerUserId(),
                                          showAll: true}, workspaceId));
    return workspace;
  }

  // List the workspaces in a site.
  private async _getWorkspaces(orgKey: number) {
    const org = this._dbManager.unwrapQueryResult(
      await this._dbManager.getOrgWorkspaces({userId: this._dbManager.getPreviewerUserId(),
                                              includeSupport: false, showAll: true}, orgKey));
    return org;
  }

  // Do whatever it takes to clean up billing information linked with site.
  private async _removeBillingFromOrg(orgKey: number): Promise<void> {
    const account = await this._dbManager.getBillingAccount(
      {userId: this._dbManager.getPreviewerUserId()}, orgKey, false);
    if (account.stripeCustomerId === null) {
      // Nothing to do.
      return;
    }
    const url = this._homeApiUrl + `/api/billing/detach?orgId=${orgKey}`;
    const permitKey = await this._permitStore.setPermit({org: orgKey});
    try {
      const result = await fetch(url, {
        method: 'POST',
        headers: {
          Permit: permitKey
        }
      });
      if (result.status !== 200) {
        // There should be a better way to just pass on the error?
        const info = await result.json().catch(e => null);
        throw new ApiError(`failed to delete customer: ${result.status} ${JSON.stringify(info)}`, result.status);
      }
    } finally {
      await this._permitStore.removePermit(permitKey);
    }
    await this._dbManager.updateBillingAccount(
      this._dbManager.getPreviewerUserId(), orgKey, async (billingAccount, transaction) => {
        billingAccount.stripeCustomerId = null;
        billingAccount.stripePlanId = null;
        billingAccount.stripeSubscriptionId = null;
      });
  }
}
