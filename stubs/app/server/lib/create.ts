import { HomeDBManager } from 'app/gen-server/lib/HomeDBManager';
import { ActiveDoc } from 'app/server/lib/ActiveDoc';
import { DocManager } from 'app/server/lib/DocManager';
import { ICreate } from 'app/server/lib/ICreate';
import { LoginSession } from 'app/server/lib/LoginSession';
import { NSandboxCreator } from 'app/server/lib/NSandbox';

// Use raw python - update when pynbox or other solution is set up for core.
const sandboxCreator = new NSandboxCreator('unsandboxed');

export const create: ICreate = {
  LoginSession() {
    return new LoginSession();
  },
  Billing(dbManager: HomeDBManager) {
    return {
      addEndpoints(app: any) { /* do nothing */ },
      addEventHandlers() { /* do nothing */ },
      addWebhooks(app: any) { /* do nothing */ }
    };
  },
  Notifier() {
    return {
      get testPending() { return false; }
    };
  },
  Shell() {
    return {
      moveItemToTrash()  { throw new Error('moveToTrash unavailable'); },
      showItemInFolder() { throw new Error('showItemInFolder unavailable'); }
    };
  },
  ExternalStorage() { return undefined; },
  ActiveDoc(docManager, docName) { return new ActiveDoc(docManager, docName); },
  DocManager(storageManager, pluginManager, homeDBManager, gristServer) {
    return new DocManager(storageManager, pluginManager, homeDBManager, gristServer);
  },
  NSandbox(options) {
    return sandboxCreator.create(options);
  },
  sessionSecret() {
    return process.env.GRIST_SESSION_SECRET ||
      'Phoo2ag1jaiz6Moo2Iese2xoaphahbai3oNg7diemohlah0ohtae9iengafieS2Hae7quungoCi9iaPh';
  }
};
