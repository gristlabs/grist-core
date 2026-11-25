import type { GristDoc } from "app/client/components/GristDoc";
import type { TableRec } from "app/client/models/DocModel";
import type { DomContents } from "grainjs";

export function buildSyncTablesButton(gristDoc: GristDoc): DomContents {
  return null;
}

export function buildSyncTargetBadge(gristDoc: GristDoc, table: TableRec): DomContents {
  return null;
}

export function buildSyncTargetMenuItems(gristDoc: GristDoc, table: TableRec): DomContents[] {
  return [];
}
