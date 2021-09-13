import { ApiError } from 'app/common/ApiError';
import { HomeDBManager, Scope } from 'app/gen-server/lib/HomeDBManager';
import { IPermitStore } from 'app/server/lib/Permit';
import fetch from 'node-fetch';

/**
 *
 * This is a tool that specializes in deletion of resources.  Deletion needs some
 * coordination between multiple services.
 *
 */
export class Doom {
  constructor(private _dbManager: HomeDBManager, private _permitStore: IPermitStore,
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
