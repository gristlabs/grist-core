import {Document} from 'app/gen-server/entity/Document';
import {HomeDBManager} from 'app/gen-server/lib/HomeDBManager';
import {ExternalStorage} from 'app/server/lib/ExternalStorage';
import {GristServer} from 'app/server/lib/GristServer';
import {IBilling} from 'app/server/lib/IBilling';
import {INotifier} from 'app/server/lib/INotifier';
import {ISandbox, ISandboxCreationOptions} from 'app/server/lib/ISandbox';
import {IShell} from 'app/server/lib/IShell';
import {createSandbox} from 'app/server/lib/NSandbox';
import * as express from 'express';

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

export function makeSimpleCreator(opts: {
  sessionSecret?: string,
  storage?: ICreateStorageOptions[],
  activationMiddleware?: (db: HomeDBManager, app: express.Express) => Promise<void>,
  notifier?: ICreateNotifierOptions,
}): ICreate {
  return {
    Billing(db) {
      return {
        addEndpoints() { /* do nothing */ },
        addEventHandlers() { /* do nothing */ },
        addWebhooks() { /* do nothing */ },
        async addMiddleware(app) {
          // add activation middleware, if needed.
          return opts?.activationMiddleware?.(db, app);
        }
      };
    },
    Notifier(dbManager, gristConfig) {
      const {notifier} = opts;
      return notifier?.create(dbManager, gristConfig) ?? {
        get testPending() { return false; },
        deleteUser()      { throw new Error('deleteUser unavailable'); },
      };
    },
    ExternalStorage(purpose, extraPrefix) {
      for (const storage of opts.storage || []) {
        if (storage.check()) {
          return storage.create(purpose, extraPrefix);
        }
      }
      return undefined;
    },
    NSandbox(options) {
      return createSandbox('unsandboxed', options);
    },
    sessionSecret() {
      const secret = process.env.GRIST_SESSION_SECRET || opts.sessionSecret;
      if (!secret) {
        throw new Error('need GRIST_SESSION_SECRET');
      }
      return secret;
    },
    async configure() {
      for (const storage of opts.storage || []) {
        if (storage.check()) { break; }
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
