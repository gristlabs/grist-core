import {get as getBrowserGlobals} from 'app/client/lib/browserGlobals';
import * as log from 'app/client/lib/log';
import {INotifyOptions, Notifier} from 'app/client/models/NotifyModel';
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
 * This error causes Notifer to show the message with an upgrade link.
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
 * Report an error to the user using the global Notifier instance. If the argument is a UserError
 * or an error with a status in the 400 range, it indicates a user error. Otherwise, it's an
 * application error, which the user can report to us as a bug.
 */
export function reportError(err: Error|string): void {
  log.error(`ERROR:`, err);
  _logError(err);
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
        actions: ['upgrade'],
      };
      if (details.tips && details.tips.some(tip => tip.action === 'add-members')) {
        // When adding members would fix a problem, give more specific advice.
        options.title = "Add users as team members first";
        options.actions = [];
      }
      _notifier.createUserError(message, options);
    } else if (err.name === 'UserError' || (typeof status === 'number' && status >= 400 && status < 500)) {
      // This is explicitly a user error, or one in the "Client Error" range, so treat it as user
      // error rather than a bug. Using message as the key causes same-message notifications to
      // replace previous ones rather than accumulate.
      const options: Partial<INotifyOptions> = {key: (err as UserError).key || message};
      if (details && details.tips && details.tips.some(tip => tip.action === 'ask-for-help')) {
        options.actions = ['ask-for-help'];
      }
      _notifier.createUserError(message, options);
    } else if (err.name === 'NeedUpgradeError') {
      _notifier.createUserError(err.message, {actions: ['upgrade'], key: 'NEED_UPGRADE'});
    } else if (code === 'AUTH_NO_EDIT') {
      _notifier.createUserError(message, {key: code});
    } else {
      // If we don't recognize it, consider it an application error (bug) that the user should be
      // able to report.
      _notifier.createAppError(err);
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
  G.window.onerror = ((ev: any, url: any, lineNo: any, colNo: any, err: any) =>
    doReportError(err || ev));

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
function _logError(error: Error|string) {
  if (!pageHasHome()) { return; }
  fetchFromHome('/api/log', {
    method: 'POST',
    body: JSON.stringify({
      // Errors don't stringify, so pick out properties explicitly for errors.
      event: (error instanceof Error) ? pick(error, Object.getOwnPropertyNames(error)) : error,
      page: G.window.location.href,
      browser: pick(G.window.navigator, ['language', 'platform', 'userAgent'])
    }),
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json'
    }
  }).catch(e => {
    // There ... isn't much we can do about this.
    // tslint:disable-next-line:no-console
    console.warn('Failed to log event', event);
  });
}
