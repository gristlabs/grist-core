import { FullUser } from 'app/common/LoginSessionAPI';
import * as roles from 'app/common/roles';
import { BillingAccount } from 'app/gen-server/entity/BillingAccount';
import { Document } from 'app/gen-server/entity/Document';
import { Organization } from 'app/gen-server/entity/Organization';
import { User } from 'app/gen-server/entity/User';
import { Workspace } from 'app/gen-server/entity/Workspace';
import { UserChange, UserIdDelta } from 'app/gen-server/lib/homedb/HomeDBManager';
import { SendGridConfig, SendGridMailWithTemplateId, TwoFactorEvent } from 'app/gen-server/lib/NotifierTypes';

/**
 *
 * Interface for events that should result in notifications to users
 * via transactional emails (or future generalizations).
 *
 * Although this interface is async, it is best if the implementation
 * remains very fast and reliable. Any delays here will impact API
 * calls. Calls to place something in Redis may be acceptable.
 * Retrying email notifications, no.
 */
export interface INotifier {
  /**
   * These methods are all called when a thing happens, with
   * the intent to notify anyone who should know.
   */
  addUser(
    userId: number,
    resource: Organization | Workspace | Document,
    delta: UserIdDelta,
    membersBefore: Map<roles.NonGuestRole, User[]>
  ): Promise<void>;
  addBillingManager(hostUserId: number, addUserId: number, orgs: Organization[]): Promise<void>;
  firstLogin(user: FullUser): Promise<void>;
  teamCreator(userId: number): Promise<void>;
  userChange(change: UserChange): Promise<void>;
  trialPeriodEndingSoon(account: BillingAccount, subscription: { trial_end: number | null }): Promise<void>;
  trialingSubscription(account: BillingAccount): Promise<void>;
  scheduledCall(userRef: string): Promise<void>;
  twoFactorStatusChanged(event: TwoFactorEvent, userId: number, method?: 'TOTP' | 'SMS'): Promise<void>;

  /**
   * A slightly different kind of event that is lurking around.
   */
  streamingDestinationsChange(orgId: number | null): Promise<void>;

  /**
   * Deliver notification of a doc change or comment. Other code is responsible for preparing the
   * payload; this method only needs to deliver it.
   */
  docNotification(userId: number, templateData: object): Promise<void>;

  /**
   * This is a bit confusing. It isn't a notification, but
   * a request to purge a user from the notification system,
   * e.g. to remove from any email lists.
   */
  deleteUser(userId: number): Promise<void>;

  /**
   * For old tests, we preserve some weird old methods.
   * This may need further refactoring or elimination.
   */
  testSendGridExtensions?(): TestSendGridExtensions|undefined;
}

export interface TestSendGridExtensions {
  // Get template IDs etc.
  getConfig(): SendGridConfig;

  // Intercept outgoing messages for test purposes.
  setSendMessageCallback(op: (body: SendGridMailWithTemplateId,
                              description: string) => Promise<void>): void;
}

/**
 * A base notifier class that by default does nothing.
 */
export class BaseNotifier implements INotifier {
  public async addUser(
    _userId: number,
    _resource: Organization | Workspace | Document,
    _delta: UserIdDelta,
    _membersBefore: Map<roles.NonGuestRole, User[]>
  ): Promise<void> {}
  public async addBillingManager(_hostUserId: number, _addUserId: number, _orgs: Organization[]): Promise<void> {}
  public async firstLogin(_user: FullUser): Promise<void> {}
  public async teamCreator(_userId: number): Promise<void> {}
  public async userChange(_change: UserChange): Promise<void> {}
  public async trialPeriodEndingSoon(
    _account: BillingAccount,
    _subscription: { trial_end: number | null }): Promise<void> {}
  public async trialingSubscription(_account: BillingAccount): Promise<void> {}
  public async scheduledCall(_userRef: string): Promise<void> {}
  public async streamingDestinationsChange(_orgId: number | null): Promise<void> {}
  public async twoFactorStatusChanged(_event: TwoFactorEvent, _userId: number,
                                      _method?: 'TOTP' | 'SMS'): Promise<void> {}

  public async docNotification(userId: number, templateData: object): Promise<void> {}
  public async deleteUser(_userId: number) {}
}

/**
 * A notifier instance that does nothing. Used when no email
 * notifications are configured.
 */
export const EmptyNotifier: INotifier = new BaseNotifier();
