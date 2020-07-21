import {Document} from 'app/gen-server/entity/Document';
import {Organization} from 'app/gen-server/entity/Organization';
import {User} from 'app/gen-server/entity/User';
import {HomeDBManager} from 'app/gen-server/lib/HomeDBManager';
import * as log from 'app/server/lib/log';

// Frequency of logging usage information.  Not something we need
// to track with much granularity.
const USAGE_PERIOD_MS = 1 * 60 * 60 * 1000;   // log every 1 hour

/**
 * Occasionally log usage information - number of users, orgs,
 * docs, etc.
 */
export class Usage {
  private _interval: NodeJS.Timeout;

  public constructor(private _dbManager: HomeDBManager) {
    this._interval = setInterval(() => this.apply().catch(log.warn.bind(log)), USAGE_PERIOD_MS);
    // Log once at beginning, in case we roll over servers faster than
    // the logging period for an extended length of time,
    // and to raise the visibility of this logging step so if it gets
    // slow devs notice.
    this.apply().catch(log.warn.bind(log));
  }

  public close() {
    clearInterval(this._interval);
  }

  public async apply() {
    const manager = this._dbManager.connection.manager;
    // raw count of users
    const userCount = await manager.count(User);
    // users who have logged in at least once
    const userWithLoginCount = await manager.createQueryBuilder()
      .from(User, 'users')
      .where('first_login_at is not null')
      .getCount();
    // raw count of organizations (excluding personal orgs)
    const orgCount = await manager.createQueryBuilder()
      .from(Organization, 'orgs')
      .where('owner_id is null')
      .getCount();
    // organizations with subscriptions that are in a non-terminated state
    const orgInGoodStandingCount = await manager.createQueryBuilder()
      .from(Organization, 'orgs')
      .leftJoin('orgs.billingAccount', 'billing_accounts')
      .where('owner_id is null')
      .andWhere('billing_accounts.in_good_standing = true')
      .getCount();
    // raw count of documents
    const docCount = await manager.count(Document);
    log.rawInfo('activity', {
      docCount,
      orgCount,
      orgInGoodStandingCount,
      userCount,
      userWithLoginCount,
    });
  }
}
