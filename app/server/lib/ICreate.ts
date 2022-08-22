import {Document} from 'app/gen-server/entity/Document';
import {HomeDBManager} from 'app/gen-server/lib/HomeDBManager';
import {ExternalStorage} from 'app/server/lib/ExternalStorage';
import {GristServer} from 'app/server/lib/GristServer';
import {IBilling} from 'app/server/lib/IBilling';
import {INotifier} from 'app/server/lib/INotifier';
import {ISandbox, ISandboxCreationOptions} from 'app/server/lib/ISandbox';
import {IShell} from 'app/server/lib/IShell';
import {createSandbox} from 'app/server/lib/NSandbox';

export interface ICreate {

  Billing(dbManager: HomeDBManager, gristConfig: GristServer): IBilling;
  Notifier(dbManager: HomeDBManager, gristConfig: GristServer): INotifier;
  Shell?(): IShell;  // relevant to electron version of Grist only.

  // Create a space to store files externally, for storing either:
  //  - documents. This store should be versioned, and can be eventually consistent.
  //  - meta. This store need not be versioned, and can be eventually consistent.
  // For test purposes an extra prefix may be supplied.  Stores with different prefixes
  // should not interfere with each other.
  ExternalStorage(purpose: 'doc' | 'meta', testExtraPrefix: string): ExternalStorage | undefined;

  NSandbox(options: ISandboxCreationOptions): ISandbox;

  sessionSecret(): string;
  // Check configuration of the app early enough to show on startup.
  configure?(): Promise<void>;
  // Return a string containing 1 or more HTML tags to insert into the head element of every
  // static page.
  getExtraHeadHtml?(): string;
}

export interface ICreateActiveDocOptions {
  safeMode?: boolean;
  docUrl?: string;
  docApiUrl?: string;
  doc?: Document;
}

export interface ICreateStorageOptions {
  check(): boolean;
  create(purpose: 'doc'|'meta', extraPrefix: string): ExternalStorage|undefined;
}

export interface ICreateNotifierOptions {
  create(dbManager: HomeDBManager, gristConfig: GristServer): INotifier|undefined;
}

export interface ICreateBillingOptions {
  create(dbManager: HomeDBManager, gristConfig: GristServer): IBilling|undefined;
}

export function makeSimpleCreator(opts: {
  sessionSecret?: string,
  storage?: ICreateStorageOptions[],
  billing?: ICreateBillingOptions,
  notifier?: ICreateNotifierOptions,
}): ICreate {
  const {sessionSecret, storage, notifier, billing} = opts;
  return {
    Billing(dbManager, gristConfig) {
      return billing?.create(dbManager, gristConfig) ?? {
        addEndpoints() { /* do nothing */ },
        addEventHandlers() { /* do nothing */ },
        addWebhooks() { /* do nothing */ },
        async addMiddleware() { /* do nothing */ },
        addPages() { /* do nothing */ },
      };
    },
    Notifier(dbManager, gristConfig) {
      return notifier?.create(dbManager, gristConfig) ?? {
        get testPending() { return false; },
        deleteUser()      { throw new Error('deleteUser unavailable'); },
      };
    },
    ExternalStorage(purpose, extraPrefix) {
      for (const s of storage || []) {
        if (s.check()) {
          return s.create(purpose, extraPrefix);
        }
      }
      return undefined;
    },
    NSandbox(options) {
      return createSandbox('unsandboxed', options);
    },
    sessionSecret() {
      const secret = process.env.GRIST_SESSION_SECRET || sessionSecret;
      if (!secret) {
        throw new Error('need GRIST_SESSION_SECRET');
      }
      return secret;
    },
    async configure() {
      for (const s of storage || []) {
        if (s.check()) { break; }
      }
    },
    getExtraHeadHtml() {
      let customHeadHtmlSnippet = '';
      if (process.env.APP_STATIC_INCLUDE_CUSTOM_CSS === 'true') {
        customHeadHtmlSnippet += '<link rel="stylesheet" href="custom.css">';
      }
      return customHeadHtmlSnippet;
    },
  };
}
