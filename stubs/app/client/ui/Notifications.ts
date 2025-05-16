import {DocInfo} from 'app/client/models/DocPageModel';
import {DocAPI} from 'app/common/UserAPI';
import {DomContents, IDisposableOwner} from 'grainjs';

// This is a stub, to be overridden in versions of Grist that implement Notifications.
export function buildNotificationsConfig(owner: IDisposableOwner, docAPI: DocAPI, doc: DocInfo|null): DomContents {
  return null;
}
