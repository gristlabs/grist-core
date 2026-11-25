import { IRowModel } from "app/client/models/DocModel";
import * as modelUtil from "app/client/models/modelUtil";
import { SyncRunStatus } from "app/common/UserAPI";

import * as ko from "knockout";

/** What a row of `_grist_Syncs` keeps in its `status` JSON */
interface SyncStatusObj {
  /** When the last successful run finished, in ms */
  lastSyncedAtMs?: number | null;
  lastSyncStatus?: SyncRunStatus;
}

// Only those who can view access rules get these rows, as with `_grist_ACLRules`.
export interface SyncRec extends IRowModel<"_grist_Syncs"> {
  lastSyncedAtMs: ko.Computed<number | null>;
  lastSyncStatus: ko.Computed<SyncRunStatus>;
}

export function createSyncRec(this: SyncRec): void {
  const statusObj: modelUtil.SaveableObjObservable<SyncStatusObj> = modelUtil.jsonObservable(this.status);
  this.lastSyncedAtMs = ko.pureComputed(() => statusObj().lastSyncedAtMs ?? null);
  this.lastSyncStatus = ko.pureComputed(() => statusObj().lastSyncStatus ?? "idle");
}
