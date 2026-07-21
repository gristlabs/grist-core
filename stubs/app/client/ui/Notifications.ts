import { AppModel } from "app/client/models/AppModel";
import { DocInfo } from "app/client/models/DocPageModel";
import { buildNotificationsAndAutomationsNudge } from "app/client/ui/NotificationsAndAutomationsNudge";
import { DocAPI } from "app/common/UserAPI";

import { DomContents, IDisposableOwner } from "grainjs";

// Editions that implement Notifications override this to render the live card when configured
// and fall back to the nudge otherwise. Core has no notifications, so it always shows the nudge.
export function buildNotificationsConfig(
  _owner: IDisposableOwner,
  appModel: AppModel,
  _docAPI: DocAPI,
  doc: DocInfo | null,
): DomContents {
  return buildNotificationsAndAutomationsNudge(appModel, doc);
}
