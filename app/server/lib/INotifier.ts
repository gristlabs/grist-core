/**
 * INotifier defines the interface for events that should result in notifications to users
 * via transactional emails (or future generalizations).
 *
 * Although this interface is async, it is best if the implementation
 * remains very fast and reliable. Any delays here will impact API
 * calls. Calls to place something in Redis may be acceptable.
 * Retrying email notifications, no.
 *
 * In practice, the notifier that does the delivery of notifications is wrapped into an
 * EmitNotifier, with fire-and-forget semantics. Its methods return without waiting for the async
 * calls.
 *
 * EmitNotifier also distributes events to other internal subscribers, e.g. via
 * FlexServer.onUserChange and FlexServer.onStreamingDestinationsChange.
 *
 * Some notifier activity ought to be replaced with
 * a job queue and queue workers. In particular, processing of
 * FlexServer.onUserChange could do with moving to a queue since
 * it may require communication with external billing software and
 * should be robust to delays and failures there. More generally,
 * if notications are subject to delays and failures and we wish to
 * be robust, a job queue would be a good idea for all of this.
 */

import { FullUser } from "app/common/LoginSessionAPI";
import * as roles from "app/common/roles";
import { BillingAccount } from "app/gen-server/entity/BillingAccount";
import { Document } from "app/gen-server/entity/Document";
import { Organization } from "app/gen-server/entity/Organization";
import { User } from "app/gen-server/entity/User";
import { Workspace } from "app/gen-server/entity/Workspace";
import { UserChange, UserIdDelta } from "app/gen-server/lib/homedb/HomeDBManager";
import { SendGridConfig, SendGridMailWithTemplateId, TwoFactorEvent } from "app/gen-server/lib/NotifierTypes";
import { DocNotificationEvent, DocNotificationTemplateBase } from "app/gen-server/lib/NotifierTypes";
import log from "app/server/lib/log";

import { EventEmitter } from "events";

interface INotifierMethods {
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
  twoFactorStatusChanged(event: TwoFactorEvent, userId: number, method?: "TOTP" | "SMS"): Promise<void>;

  /**
   * A slightly different kind of event that is lurking around.
   */
  streamingDestinationsChange(orgId: number | null): Promise<void>;

  /**
   * Deliver notification of a doc change or comment. Other code is responsible for preparing the
   * payload; this method only needs to deliver it.
   */
  docNotification(
    event: DocNotificationEvent, userId: number, templateData: DocNotificationTemplateBase
  ): Promise<void>;

  /**
   * This is a bit confusing. It isn't a notification, but
   * a request to purge a user from the notification system,
   * e.g. to remove from any email lists.
   */
  deleteUser(userId: number): Promise<void>;
}

export interface INotifier extends INotifierMethods {
  /**
   * For old tests, we preserve some weird old methods.
   * This may need further refactoring or elimination.
   */
  testSendGridExtensions?(): TestSendGridExtensions | undefined;
}

export interface TestSendGridExtensions {
  // Get template IDs etc.
  getConfig(): SendGridConfig;

  // Intercept outgoing messages for test purposes.
  setSendMessageCallback(op: (body: SendGridMailWithTemplateId,
    description: string) => Promise<void>): void;
}

/**
 * EmitNotifier wraps another INotifier, but introduces two differences:
 * - The wrapped INotifier is optional; if not set via setPrimaryNotifier(), it's just not called.
 * - Each call returns immediately; any errors in the underlying async call are caught and logged.
 * - It is an EventEmitter; for every INotifier method it emits an event with the same name and
 *   the same arguments, to allow other code to subscribe.
 */
export class EmitNotifier extends EventEmitter implements INotifier {
  public addUser = this._wrapEvent("addUser");
  public addBillingManager = this._wrapEvent("addBillingManager");
  public firstLogin = this._wrapEvent("firstLogin");
  public teamCreator = this._wrapEvent("teamCreator");
  public userChange = this._wrapEvent("userChange");
  public trialPeriodEndingSoon = this._wrapEvent("trialPeriodEndingSoon");
  public trialingSubscription = this._wrapEvent("trialingSubscription");
  public scheduledCall = this._wrapEvent("scheduledCall");
  public streamingDestinationsChange = this._wrapEvent("streamingDestinationsChange");
  public twoFactorStatusChanged = this._wrapEvent("twoFactorStatusChanged");
  public docNotification = this._wrapEvent("docNotification");
  public deleteUser = this._wrapEvent("deleteUser");

  private _primaryNotifier: INotifier | null = null;
  private _testPendingNotifications = 0;

  public setPrimaryNotifier(notifier: INotifier) { this._primaryNotifier = notifier; }

  public isEmpty() { return !this._primaryNotifier; }

  public testSendGridExtensions() { return this._primaryNotifier?.testSendGridExtensions?.(); }
  public testPendingNotifications(): number { return this._testPendingNotifications; }

  private _wrapEvent<Name extends keyof INotifierMethods>(methodName: Name): INotifier[Name] {
    return async (...args: any[]) => {
      this._callPrimary(methodName, ...args)
        .catch(e => log.error("Notifier failed", e));

      // Also emit as an event that others could listen to.
      this.emit(methodName, ...args);
    };
  }

  private async _callPrimary(methodName: keyof INotifierMethods, ...args: any[]) {
    if (!this._primaryNotifier) { return; }
    this._testPendingNotifications++;
    try {
      await (this._primaryNotifier[methodName] as any)(...args);
    }
    finally {
      this._testPendingNotifications--;
    }
  }
}
