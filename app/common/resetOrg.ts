import {isOwner} from 'app/common/roles';
import {ManagerDelta, PermissionDelta, UserAPI} from 'app/common/UserAPI';

/**
 * A utility to reset an organization into the state it would have when first
 * created - no docs, one workspace called "Home", a single user.  Should be
 * called by a user who is both an owner of the org and a billing manager.
 */
export async function resetOrg(api: UserAPI, org: string|number) {
  const session = await api.getSessionActive();
  if (!isOwner(session.org)) {
    throw new Error('user must be an owner of the org to be reset');
  }
  const billing = api.getBillingAPI();
  // If billing api is not available, don't bother setting billing manager.
  const account = await billing.getBillingAccount().catch(e => null);
  if (account && !account.managers.some(manager => (manager.id === session.user.id))) {
    throw new Error('user must be a billing manager');
  }
  const wss = await api.getOrgWorkspaces(org);
  for (const ws of wss) {
    if (!ws.isSupportWorkspace) {
      await api.deleteWorkspace(ws.id);
    }
  }
  await api.newWorkspace({name: 'Home'}, org);
  const permissions: PermissionDelta = { users: {} };
  for (const user of (await api.getOrgAccess(org)).users) {
    if (user.id !== session.user.id) {
      permissions.users![user.email] = null;
    }
  }
  await api.updateOrgPermissions(org, permissions);
  // For non-individual accounts, update billing managers (individual accounts will
  // throw an error if we try to do this).
  if (account && !account.individual) {
    const managers: ManagerDelta = { users: {} };
    for (const user of account.managers) {
      if (user.id !== session.user.id) {
        managers.users[user.email] = null;
      }
    }
    await billing.updateBillingManagers(managers);
  }
  return api;
}
