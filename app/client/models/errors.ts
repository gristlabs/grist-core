import {get as getBrowserGlobals} from 'app/client/lib/browserGlobals';
import * as log from 'app/client/lib/log';
import {INotification, INotifyOptions, MessageType, Notifier} from 'app/client/models/NotifyModel';
import {ApiErrorDetails} from 'app/common/ApiError';
import {fetchFromHome, pageHasHome} from 'app/common/urlUtils';
import isError = require('lodash/isError');
import pick = require('lodash/pick');

const G = getBrowserGlobals('document', 'window');

let _notifier: Notifier;

export class UserError extends Error {
  public name: string = "UserError";
  public key?: string;
  constructor(message: string, options: {key?: string} = {}) {
    super(message);
    this.key = options.key;
  }
}

/**
 * This error causes Notifier to show the message with an upgrade link.
 */
export class NeedUpgradeError extends Error {
  public name: string = 'NeedUpgradeError';
  constructor(message: string = 'This feature is not available in your plan') {
    super(message);
  }
}

/**
 * Set the global Notifier instance used by subsequent reportError calls.
 */
export function setErrorNotifier(notifier: Notifier) {
  _notifier = notifier;
}

// Returns application errors collected by NotifyModel. Used in tests.
export function getAppErrors(): string[] {
  return _notifier.getFullAppErrors().map((e) => e.error.message);
}

/**
 * Shows normal notification without any styling or icon.
 */
export function reportMessage(msg: MessageType, options?: Partial<INotifyOptions>): INotification|undefined {
  if (_notifier && !_notifier.isDisposed()) {
    return _notifier.createUserMessage(msg, {
      ...options
    });
  }
}

/**
 * Shows warning toast notification (with yellow styling), and log to server and to console. Pass
 * {level: 'error'} for same behavior with adjusted styling.
 */
export function reportWarning(msg: string, options?: Partial<INotifyOptions>) {
  options = {level: 'warning', ...options};
  log.warn(`${options.level}: `, msg);
  logError(msg);
  return reportMessage(msg, options);
}

/**
 * Shows success toast notification (with green styling).
 */
export function reportSuccess(msg: MessageType, options?: Partial<INotifyOptions>) {
  return reportMessage(msg, {level: 'success', ...options});
}

function isUnhelpful(ev: ErrorEvent) {
  if (ev.message === 'ResizeObserver loop completed with undelivered notifications.') {
    // Sometimes on Chrome, changing the browser zoom level causes this benign error to
    // be thrown. It seems to only appear on the Access Rules page, and may have something
    // to do with Ace. In any case, the error seems harmless and it isn't particularly helpful,
    // so we don't report it more than once. A quick Google search for the error message
    // produces many reports, although at the time of this comment, none seem to be related
    // to Ace, so there's a chance something else is amiss.
    return true;
  }

  if (!ev.filename && !ev.lineno && ev.message?.toLowerCase().includes('script error')) {
    // Errors from cross-origin scripts, and some add-ons, show up as unhelpful sanitized "Script
    // error." messages. We want to know if they occur, but they are useless to the user, and useless
    // to report multiple times. We report them just once to the server.
    //
    // In particular, this addresses a bug on iOS version of Firefox, which produces uncaught
    // sanitized errors on load AND on attempts to report them, leading to a loop that hangs the
    // browser. Reporting just once is a sufficient workaround.
    return true;
  }

  return false;
}

const unhelpfulErrors = new Set<string>();

/**
 * Report an error to the user using the global Notifier instance. If the argument is a UserError
 * or an error with a status in the 400 range, it indicates a user error. Otherwise, it's an
 * application error, which the user can report to us as a bug.
 *
 * Not all errors will be shown as an error toast, depending on the content of the error
 * this function might show a simple toast message.
 */
export function reportError(err: Error|string, ev?: ErrorEvent): void {
  log.error(`ERROR:`, err);
  if (String(err).match(/GristWSConnection disposed/)) {
    // This error can be emitted while a page is reloaded, and isn't worth reporting.
    return;
  }
  if (ev && isUnhelpful(ev)) {
    // Report just once to the server. There is little point reporting subsequent such errors once
    // we know they happen, since each individual error has no useful information.
    if (!unhelpfulErrors.has(ev.message)) {
      logError(err);
      unhelpfulErrors.add(ev.message);
    }
    return;
  }

  logError(err);
  if (_notifier && !_notifier.isDisposed()) {
    if (!isError(err)) {
      err = new Error(String(err));
    }

    const details: ApiErrorDetails|undefined = (err as any).details;
    const code: unknown = (err as any).code;
    const status: unknown = (err as any).status;
    const message = (details && details.userError) || err.message;
    if (details && details.limit) {
      // This is a notification about reaching a plan limit. Key prevents showing multiple
      // notifications for the same type of limit.
      const options: Partial<INotifyOptions> = {
        title: "Reached plan limit",
        key: `limit:${details.limit.quantity || message}`,
        actions: details.tips?.some(t => t.action === 'manage') ? ['manage'] : ['upgrade'],
      };
      if (details.tips && details.tips.some(tip => tip.action === 'add-members')) {
        // When adding members would fix a problem, give more specific advice.
        options.title = "Add users as team members first";
        options.actions = [];
      }
      // Show the error as a message
      _notifier.createUserMessage(message, options);
    } else if (err.name === 'UserError' || (typeof status === 'number' && status >= 400 && status < 500)) {
      // This is explicitly a user error, or one in the "Client Error" range, so treat it as user
      // error rather than a bug. Using message as the key causes same-message notifications to
      // replace previous ones rather than accumulate.
      const options: Partial<INotifyOptions> = {key: (err as UserError).key || message};
      if (details && details.tips && details.tips.some(tip => tip.action === 'ask-for-help')) {
        options.actions = ['ask-for-help'];
      }
      _notifier.createUserMessage(message, options);
    } else if (err.name === 'NeedUpgradeError') {
      // Show the error as a message
      _notifier.createUserMessage(err.message, {actions: ['upgrade'], key: 'NEED_UPGRADE'});
    } else if (code === 'AUTH_NO_EDIT' || code === 'ACL_DENY') {
      // Show the error as a message
      _notifier.createUserMessage(err.message, {key: code, memos: details?.memos});
    } else if (message.match(/\[Sandbox\].*between formula and data/)) {
      // Show nicer error message for summary tables.
      _notifier.createUserMessage("Summary tables can only contain formula columns.",
        {key: 'summary', actions: ['ask-for-help']});
    }  else {
      // If we don't recognize it, consider it an application error (bug) that the user should be
      // able to report.
      if (details?.userError) {
        // If we have user friendly error, show it instead.
        _notifier.createAppError(Error(details.userError));
      } else {
        _notifier.createAppError(err);
      }
    }
  }
}

/**
 * Set up error handlers, to report uncaught errors and rejections. These are logged to the
 * console and displayed as notifications, when the notifications UI is set up.
 *
 * koUtil, if passed, will enable reporting errors from the evaluation of knockout computeds. It
 * is passed-in as an argument to avoid creating a dependency when knockout isn't used otherwise.
 */
export function setUpErrorHandling(doReportError = reportError, koUtil?: any) {
  if (koUtil) {
    koUtil.setComputedErrorHandler((err: any) => doReportError(err));
  }

  // Report also uncaught JS errors and unhandled Promise rejections.
  G.window.addEventListener('error', (ev: ErrorEvent) => doReportError(ev.error || ev.message, ev));

  G.window.addEventListener('unhandledrejection', (ev: any) => {
    const reason = ev.reason || (ev.detail && ev.detail.reason);
    doReportError(reason || ev);
  });

  // Expose globally a function to report a notification. This is for compatibility with old UI;
  // in new UI, it renders messages as user errors. New code should use `reportError()` instead.
  G.window.gristNotify = (message: string) => doReportError(new UserError(message));

  // Expose the function used in tests to get a list of errors in the notifier.
  G.window.getAppErrors = getAppErrors;
}

/**
 * Send information about a problem to the backend.  This is crude; there is some
 * over-logging (regular errors such as access rights or account limits) and
 * under-logging (javascript errors during startup might never get reported).
 */
export function logError(error: Error|string) {
  if (!pageHasHome()) { return; }
  const docId = G.window.gristDocPageModel?.currentDocId?.get();
  fetchFromHome('/api/log', {
    method: 'POST',
    body: JSON.stringify({
      // Errors don't stringify, so pick out properties explicitly for errors.
      event: (error instanceof Error) ? pick(error, Object.getOwnPropertyNames(error)) : error,
      docId,
      page: G.window.location.href,
      browser: pick(G.window.navigator, ['language', 'platform', 'userAgent'])
    }),
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
    }
  }).catch(e => {
    // There ... isn't much we can do about this.
    // tslint:disable-next-line:no-console
    console.warn('Failed to log event', e);
  });
}
