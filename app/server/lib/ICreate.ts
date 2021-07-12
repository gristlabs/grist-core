import {HomeDBManager} from 'app/gen-server/lib/HomeDBManager';
import {ActiveDoc} from 'app/server/lib/ActiveDoc';
import {ScopedSession} from 'app/server/lib/BrowserSession';
import {DocManager} from 'app/server/lib/DocManager';
import {ExternalStorage} from 'app/server/lib/ExternalStorage';
import {GristServer} from 'app/server/lib/GristServer';
import {IBilling} from 'app/server/lib/IBilling';
import {INotifier} from 'app/server/lib/INotifier';
import {ISandbox, ISandboxCreationOptions} from 'app/server/lib/ISandbox';
import {IShell} from 'app/server/lib/IShell';

export interface ICreate {
  // A ScopedSession knows which user is logged in to an org. This method may be used to replace
  // its behavior with stubs when logins aren't available.
  adjustSession(scopedSession: ScopedSession): void;

  Billing(dbManager: HomeDBManager, gristConfig: GristServer): IBilling;
  Notifier(dbManager: HomeDBManager, gristConfig: GristServer): INotifier;
  Shell(): IShell|undefined;

  // Create a space to store files externally, for storing either:
  //  - documents. This store should be versioned, and can be eventually consistent.
  //  - meta. This store need not be versioned, and can be eventually consistent.
  // For test purposes an extra prefix may be supplied.  Stores with different prefixes
  // should not interfere with each other.
  ExternalStorage(purpose: 'doc' | 'meta', testExtraPrefix: string): ExternalStorage|undefined;

  ActiveDoc(docManager: DocManager, docName: string, options: ICreateActiveDocOptions): ActiveDoc;
  NSandbox(options: ISandboxCreationOptions): ISandbox;

  sessionSecret(): string;
  // Get configuration information to show at start-up.
  configurationOptions(): {[key: string]: any};
}

export interface ICreateActiveDocOptions {
  safeMode?: boolean;
  docUrl?: string;
}
