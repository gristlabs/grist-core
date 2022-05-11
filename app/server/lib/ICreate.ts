import {Document} from 'app/gen-server/entity/Document';
import {HomeDBManager} from 'app/gen-server/lib/HomeDBManager';
import {ActiveDoc} from 'app/server/lib/ActiveDoc';
import {DocManager} from 'app/server/lib/DocManager';
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
  Shell(): IShell|undefined;

  // Create a space to store files externally, for storing either:
  //  - documents. This store should be versioned, and can be eventually consistent.
  //  - meta. This store need not be versioned, and can be eventually consistent.
  // For test purposes an extra prefix may be supplied.  Stores with different prefixes
  // should not interfere with each other.
  ExternalStorage(purpose: 'doc' | 'meta', testExtraPrefix: string): ExternalStorage | undefined;

  ActiveDoc(docManager: DocManager, docName: string, options: ICreateActiveDocOptions): ActiveDoc;
  NSandbox(options: ISandboxCreationOptions): ISandbox;

  sessionSecret(): string;
  // Get configuration information to show at start-up.
  configurationOptions(): {[key: string]: any};
  // Return a string containing 1 or more HTML tags to insert into the head element of every
  // static page.
  getExtraHeadHtml?(): string;
}

export interface ICreateActiveDocOptions {
  safeMode?: boolean;
  docUrl?: string;
  doc?: Document;
}

export interface ICreateStorageOptions {
  check(): Record<string, string>|undefined;
  create(purpose: 'doc'|'meta', extraPrefix: string): ExternalStorage|undefined;
}

export function makeSimpleCreator(opts: {
  sessionSecret?: string,
  storage?: ICreateStorageOptions[],
  activationMiddleware?: (db: HomeDBManager, app: express.Express) => Promise<void>,
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
    Notifier() {
      return {
        get testPending() { return false; },
        deleteUser()      { throw new Error('deleteUser unavailable'); },
      };
    },
    Shell() {
      return {
        moveItemToTrash()  { throw new Error('moveToTrash unavailable'); },
        showItemInFolder() { throw new Error('showItemInFolder unavailable'); }
      };
    },
    ExternalStorage(purpose, extraPrefix) {
      for (const storage of opts.storage || []) {
        const config = storage.check();
        if (config) { return storage.create(purpose, extraPrefix); }
      }
      return undefined;
    },
    ActiveDoc(docManager, docName, options) { return new ActiveDoc(docManager, docName, options); },
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
    configurationOptions() {
      for (const storage of opts.storage || []) {
        const config = storage.check();
        if (config) { return config; }
      }
      return {};
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
