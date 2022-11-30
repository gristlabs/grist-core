import {GristLoadConfig} from 'app/common/gristUrls';
import {BillingAccount} from 'app/gen-server/entity/BillingAccount';
import {Organization} from 'app/gen-server/entity/Organization';
import {Product} from 'app/gen-server/entity/Product';
import {HomeDBManager} from 'app/gen-server/lib/HomeDBManager';
import {INotifier} from 'app/server/lib/INotifier';
import {AxiosRequestConfig} from "axios";
import {delay} from 'bluebird';

/**
 * Returns an AxiosRequestConfig, that identifies the user with `username` on a server running
 * against a database using `test/gen-server/seed.ts`. Also tells axios not to raise exception on
 * failed request.
 */
export function configForUser(username: string): AxiosRequestConfig {
  const config: AxiosRequestConfig = {
    responseType: 'json',
    validateStatus: (status: number) => true,
    headers: {
      'X-Requested-With': 'XMLHttpRequest',
    }
  };
  if (username !== 'Anonymous') {
    config.headers.Authorization = 'Bearer api_key_for_' + username.toLowerCase();
  }
  return config;
}

/**
 * Appends a permit key to the given config. Creates a new config object.
 */
export function configWithPermit(config: AxiosRequestConfig, permitKey: string): AxiosRequestConfig {
  return {
    ...config,
    headers: {
      ...config.headers,
      Permit: permitKey
    }
  };
}

/**
 * Create a new user and return their personal org.
 */
export async function createUser(dbManager: HomeDBManager, name: string): Promise<Organization> {
  const username = name.toLowerCase();
  const email = `${username}@getgrist.com`;
  const user = await dbManager.getUserByLogin(email, {profile: {email, name}});
  if (!user) { throw new Error('failed to create user'); }
  user.apiKey = `api_key_for_${username}`;
  await user.save();
  const userHome = (await dbManager.getOrg({userId: user.id}, null)).data;
  if (!userHome) { throw new Error('failed to create personal org'); }
  return userHome;
}

/**
 * Associate a given org with a given product.
 */
export async function setPlan(dbManager: HomeDBManager, org: {billingAccount?: {id: number}},
                              productName: string) {
  const product = await dbManager.connection.manager.findOne(Product, {where: {name: productName}});
  if (!product) { throw new Error(`cannot find product ${productName}`); }
  if (!org.billingAccount) { throw new Error('must join billingAccount'); }
  await dbManager.connection.createQueryBuilder()
    .update(BillingAccount)
    .set({product})
    .where('id = :bid', {bid: org.billingAccount.id})
    .execute();
}

/**
 * Returns the window.gristConfig object extracted from the raw HTML of app.html page.
 */
export function getGristConfig(page: string): Partial<GristLoadConfig> {
  const match = /window\.gristConfig = ([^;]*)/.exec(page);
  if (!match) { throw new Error('cannot find grist config'); }
  return JSON.parse(match[1]);
}

/**
 * Waits for all pending (back-end) notifications to complete.  Notifications are
 * started during request handling, but may not complete fully during it.
 */
export async function waitForAllNotifications(notifier: INotifier, maxWait: number = 1000) {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    if (!notifier.testPending) { return; }
    await delay(1);
  }
  throw new Error('waitForAllNotifications timed out');
}

// count the number of rows in a table
export async function getRowCount(dbManager: HomeDBManager, tableName: string): Promise<number> {
  const result = await dbManager.connection.query(`select count(*) as ct from ${tableName}`);
  return parseInt(result[0].ct, 10);
}

// gather counts for all significant tables - handy as a sanity check on deletions
export async function getRowCounts(dbManager: HomeDBManager) {
  return {
    aclRules: await getRowCount(dbManager, 'acl_rules'),
    docs: await getRowCount(dbManager, 'docs'),
    groupGroups: await getRowCount(dbManager, 'group_groups'),
    groupUsers: await getRowCount(dbManager, 'group_users'),
    groups: await getRowCount(dbManager, 'groups'),
    logins: await getRowCount(dbManager, 'logins'),
    orgs: await getRowCount(dbManager, 'orgs'),
    users: await getRowCount(dbManager, 'users'),
    workspaces: await getRowCount(dbManager, 'workspaces'),
    billingAccounts: await getRowCount(dbManager, 'billing_accounts'),
    billingAccountManagers: await getRowCount(dbManager, 'billing_account_managers'),
    products: await getRowCount(dbManager, 'products')
  };
}
