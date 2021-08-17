import {ActiveDoc} from 'app/server/lib/ActiveDoc';
import {ICreate} from 'app/server/lib/ICreate';
import {NSandboxCreator} from 'app/server/lib/NSandbox';

// Use raw python - update when pynbox or other solution is set up for core.
const sandboxCreator = new NSandboxCreator({defaultFlavor: 'unsandboxed'});

export const create: ICreate = {
  Billing() {
    return {
      addEndpoints() { /* do nothing */ },
      addEventHandlers() { /* do nothing */ },
      addWebhooks() { /* do nothing */ }
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
  ActiveDoc(docManager, docName, options) { return new ActiveDoc(docManager, docName, options); },
  NSandbox(options) {
    return sandboxCreator.create(options);
  },
  sessionSecret() {
    return process.env.GRIST_SESSION_SECRET ||
      'Phoo2ag1jaiz6Moo2Iese2xoaphahbai3oNg7diemohlah0ohtae9iengafieS2Hae7quungoCi9iaPh';
  },
  configurationOptions() {
    return {};
  }
};
