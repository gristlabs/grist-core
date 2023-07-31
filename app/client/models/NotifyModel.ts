import * as log from 'app/client/lib/log';
import {ConnectState, ConnectStateManager} from 'app/client/models/ConnectState';
import {isNarrowScreenObs, testId} from 'app/client/ui2018/cssVars';
import {delay} from 'app/common/delay';
import {isLongerThan} from 'app/common/gutil';
import {InactivityTimer} from 'app/common/InactivityTimer';
import {timeFormat} from 'app/common/timeFormat';
import {
  bundleChanges,
  Computed,
  Disposable,
  dom,
  DomElementArg,
  Holder,
  IDisposable,
  IDisposableOwner,
  MutableObsArray,
  obsArray,
  Observable
} from 'grainjs';
import clamp = require('lodash/clamp');
import defaults = require('lodash/defaults');

// When rendering app errors, we'll only show the last few.
const maxAppErrors = 5;

interface INotifier {
  createUserMessage(message: string, options?: INotifyOptions): INotification;
  // If you are looking to report errors, please do that via reportError rather
  // than these methods so that we have a chance to send the error to our logs.
  createAppError(error: Error): void;

  createProgressIndicator(name: string, size: string, expireOnComplete: boolean): IProgress;
  createNotification(options: INotifyOptions): INotification;
  setConnectState(isConnected: boolean): void;
  slowNotification<T>(promise: Promise<T>, optTimeout?: number): Promise<T>;
  getFullAppErrors(): IAppError[];
}

export interface INotification extends Expirable {
  expire(): Promise<void>;
}

export interface IProgress extends Expirable {
  setProgress(percent: number): void;
}

/**
 * Custom action to be shown as a notification with a handler.
 */
export interface CustomAction { label: string, action: () => void }
/**
 * A string, or a function that builds dom.
 */
export type MessageType = string | (() => DomElementArg);
// Identifies supported actions. These are implemented in NotifyUI.
export type NotifyAction = 'upgrade' | 'renew' | 'personal' | 'report-problem'
                           | 'ask-for-help' | 'manage' | CustomAction;
export interface INotifyOptions {
  message: MessageType;     // A string, or a function that builds dom.
  timestamp?: number;
  title?: string;
  canUserClose?: boolean;
  inToast?: boolean;
  inDropdown?: boolean;
  expireSec?: number;
  badgeCounter?: boolean;
  level: 'message' | 'info' | 'success' | 'warning' | 'error';

  memos?: string[];  // A list of relevant notes.

  // cssToastAction class from NotifyUI will be applied automatically to action elements.
  actions?: NotifyAction[];

  // When set, the notification will replace any previous notification with the same key.
  // This way, we can avoid accumulating many of substantially identical notifications.
  key?: string|null;
}

type Status = 'active' | 'expiring';

export class Expirable extends Disposable {
  public static readonly fadeDelay = 250;
  public readonly status = Observable.create<Status>(this, 'active');

  constructor() {
    super();
  }

  /**
   * Sets status to 'expiring', then calls dispose after a short delay.
   */
  public async expire(withoutDelay: boolean = false): Promise<void> {
    this.status.set('expiring');
    if(!withoutDelay) {
      await delay(Expirable.fadeDelay);
    }
    if (!this.isDisposed()) {
      this.dispose();
    }
  }
}

export class Notification extends Expirable implements INotification {

  public options: Required<INotifyOptions> = {
    title: '',
    message: '',
    timestamp: Date.now(),
    inDropdown: false,
    badgeCounter: false,
    inToast: true,
    expireSec: 0,
    canUserClose: false,
    actions: [],
    memos: [],
    key: null,
    level: 'message'
  };

  constructor(_opts: INotifyOptions) {
    super();
    this.options = defaults({}, _opts, this.options);

    if (this.options.expireSec > 0) {
      const expireTimer = setTimeout(() => this.expire(), 1000 * this.options.expireSec);
      this.onDispose(() => clearTimeout(expireTimer));
    }
  }
}

interface IProgressOptions {
  name: string;
  size: string;
  expireOnComplete?: boolean;
}

export class Progress extends Expirable implements IProgress {

  public readonly progress = Observable.create(this, 0);

  constructor(public options: IProgressOptions) {
    super();

    if (options.expireOnComplete) {
      this.autoDispose(this.progress.addListener(async progress => {
        if (progress >= 100) {
          await this.expire();
        }
      }));
    }
  }

  /**
   * progress should be between 0 and 100.
   */
  public setProgress(progress: number) {
    this.progress.set(clamp(progress, 0, 100));
  }
}

/**
 * Similar to grainjs MultiHolder, but knows when items are disposed externally and releases them
 * (avoiding the "already disposed" warnings in that case). This is probably how grainjs's
 * MultiHolder should actually work, and maybe how `Disposable.autoDispose` should generally work.
 */
export class BetterMultiHolder implements IDisposableOwner {
  private _items = new Set<IDisposable>();

  public autoDispose<T extends IDisposable>(obj: T): T {
    this._items.add(obj);
    if (obj instanceof Disposable) {
      obj.onDispose(() => this._items.delete(obj));
    }
    return obj;
  }

  public dispose() {
    for (const item of this._items) {
      item.dispose();
    }
    this._items.clear();
  }
}

export interface IAppError {
  error: Error;
  timestamp: number;
  seen?: boolean;       // If seen, this will be hidden from the "app errors" toast
}

export class Notifier extends Disposable implements INotifier {
  private _itemsHolder = this.autoDispose(new BetterMultiHolder());

  private _toasts = this.autoDispose(obsArray<Notification>());
  private _dropdownItems = this.autoDispose(obsArray<Notification>());
  private _progressItems = this.autoDispose(obsArray<Progress>([]));
  private _keyedItems = new Map<string, Notification>();

  private _connectStateManager = ConnectStateManager.create(this);
  private _connectState = this._connectStateManager.connectState;
  private _disconnectMsg = Computed.create(this, (use) => getDisconnectMessage(use(this._connectState)));

  // Holds recent application errors, which the user may report to us.
  private _appErrorList = this.autoDispose(obsArray<IAppError>());

  // The dropdown will show all recent errors; the toast only the "new" ones, i.e. those since the
  // last toast was closed.
  private _appErrorDropdownItem = Holder.create<INotification>(this);
  private _appErrorToast = Holder.create<INotification>(this);
  private _slowNotificationToast = Holder.create<INotification>(this);
  private _slowNotificationInactivityTimer = new InactivityTimer(() => this._slowNotificationToast.clear(), 0);

  constructor() {
    super();
    Computed.create(this, this._disconnectMsg, (use, msg) =>
      msg ? use.owner.autoDispose(this.createNotification({
        message: msg.message,
        title: msg.title,
        canUserClose: true,
        inToast: true,
        level : 'message'
      })) : null);
  }

  /**
   * Exposes all the state needed for building UI. This is simply to clarify the intended usage:
   * these members aren't intended to be exposed, except to the UI-building code.
   */
  public getStateForUI() {
    return {
      toasts: this._toasts,
      dropdownItems: this._dropdownItems,
      progressItems: this._progressItems,
      connectState: this._connectState,
      disconnectMsg: this._disconnectMsg,
    };
  }

  /**
   * Creates a basic toast notification. By default, expires in 10 seconds.
   * Takes an options objects to configure `expireSec` and `canUserClose`.
   * Set `expireSec` to 0 to prevent expiration.
   *
   * Additional option level, can be used to style the notification to like a success, warning,
   * info or error message.
   */
  public createUserMessage(message: MessageType, options: Partial<INotifyOptions> = {}): INotification {
    const timestamp = Date.now();
    if (options.actions && options.actions.includes('ask-for-help')) {
      // If user should be able to ask for help, add this error to the notifier dropdown too for a
      // good while, so the user can find it after the toast disappears.
      this.createNotification({
        timestamp,
        message,
        inToast: false,
        expireSec: 300,
        canUserClose: true,
        level: 'message',
        inDropdown: true,
        ...options,
        key: options.key && ("dropdown:" + options.key),
      });
    }
    return this.createNotification({
      timestamp,
      message,
      inToast: true,
      expireSec: 10,
      canUserClose: true,
      inDropdown: false,
      level: 'message',
      ...options,
    });
  }

  /**
   * If you are looking to report errors, please do that via reportError so
   * that we have a chance to send the error to our logs.
   */
  public createAppError(error: Error): void {
    bundleChanges(() => {
      // Remove old messages, to keep a max of maxAppErrors.
      if (this._appErrorList.get().length >= maxAppErrors) {
        this._appErrorList.splice(0, this._appErrorList.get().length - maxAppErrors + 1);
      }
      this._appErrorList.push({error, timestamp: Date.now()});
    });

    // Create a dropdown item for errors if we don't have one yet.
    if (this._appErrorDropdownItem.isEmpty()) {
      this._appErrorDropdownItem.autoDispose(this._createAppErrorItem('dropdown'));
    }

    // Create a toast for errors if we don't have one yet. When it's closed, mark the items as
    // "seen" (i.e. not to be shown when the toast pops up again).
    if (this._appErrorToast.isEmpty()) {
      const n = this._appErrorToast.autoDispose(this._createAppErrorItem('toast'));
      n.onDispose(() => this._appErrorList.get().forEach((appErr) => { appErr.seen = true; }));
    }
  }

  public createNotification(opts: INotifyOptions): INotification {
    const n = Notification.create(this._itemsHolder, opts);
    this._addNotification(n).catch((e) => { log.warn('_addNotification failed', e); });
    return n;
  }

  public createProgressIndicator(name: string, size: string, expireOnComplete = false): IProgress {
    // Progress objects normally dispose themselves; constructor disposes any leftover items.
    const p = Progress.create(this._itemsHolder, {name, size, expireOnComplete});
    this._progressItems.push(p);
    p.onDispose(() => this.isDisposed() || arrayRemove(this._progressItems, p));
    return p;
  }

  public setConnectState(isConnected: boolean): void {
    this._connectStateManager.setConnected(isConnected);
  }

  public getFullAppErrors() {
    return this._appErrorList.get();
  }

  // This is exposed primarily for tests.
  public clearAppErrors() {
    this._appErrorList.splice(0);
    this._appErrorToast.clear();
  }

  /**
   * Show a notification when promise takes longer than optTimeout to resolve. Returns the passed in
   * promise.
   */
  public async slowNotification<T>(promise: Promise<T>, optTimeout: number = 1000): Promise<T> {
    if (await isLongerThan(promise, optTimeout)) {
      if (this._slowNotificationToast.isEmpty()) {
        this._slowNotificationToast.autoDispose(this.createNotification({
          message: "Still working...",
          canUserClose: false,
          inToast: true,
          level: 'message',
        }));
      }
      await this._slowNotificationInactivityTimer.disableUntilFinish(promise);
    }
    return promise;
  }

  private async _addNotification(n: Notification): Promise<void> {
    const key = n.options.key;
    if (key) {
      const prev = this._keyedItems.get(key);
      if (prev) {
        await prev.expire(true);
      }
      this._keyedItems.set(key, n);
      n.onDispose(() => this.isDisposed() || this._keyedItems.delete(key));
    }
    if (n.options.inToast) {
      this._toasts.push(n);
      n.onDispose(() => this.isDisposed() || arrayRemove(this._toasts, n));
    }
    if (n.options.inDropdown) {
      this._dropdownItems.push(n);
      n.onDispose(() => this.isDisposed() || arrayRemove(this._dropdownItems, n));
    }
  }

  private _createAppErrorItem(where: 'toast' | 'dropdown') {
    return this.createNotification({
      // Building DOM here in NotifyModel seems wrong, but I haven't come up with a better way.
      message: () => dom.domComputed((use) => {
        let appErrors = use(this._appErrorList);

        // On narrow screens, only show the most recent error in toasts to conserve space.
        if (where === 'toast' && use(isNarrowScreenObs())) {
          appErrors = appErrors.length > 0 ? [appErrors[appErrors.length - 1]] : [];
        }

        return dom('div',
          dom.forEach(appErrors, (appErr: IAppError) =>
            (where === 'toast' && appErr.seen ? null :
              dom('div', timeFormat('T', new Date(appErr.timestamp)), ' ',
                  appErr.error.message, testId('notification-app-error'))
            )
          ),
          testId('notification-app-errors')
        );
      }),
      title: 'Unexpected error',
      canUserClose: true,
      inToast: where === 'toast',
      expireSec: where === 'toast' ? 10 : 0,
      inDropdown: where === 'dropdown',
      actions: ['report-problem'],
      level: 'error',
    });
  }
}

function arrayRemove<T>(arr: MutableObsArray<T>, elem: T) {
  const removeIdx = arr.get().findIndex(e => e === elem);
  if (removeIdx !== -1) {
    arr.splice(removeIdx, 1);
  }
}

function getDisconnectMessage(state: ConnectState): {title: string, message: string}|undefined {
  switch (state) {
    case ConnectState.RecentlyDisconnected:
      return {title: 'Connection is lost', message: 'Attempting to reconnect...'};
    case ConnectState.ReallyDisconnected:
      return {title: 'Not connected', message: 'The document is in read-only mode until you are back online.'};
  }
}
