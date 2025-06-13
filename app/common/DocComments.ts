import {SchemaTypes} from 'app/common/schema';
import {safeJsonParse} from 'app/common/gutil';
import {makeAnchorLinkValue} from 'app/common/gristUrls';

/**
 * TODO: This is just a skeleton of what we need to extract comment data for notifications
 * purposes.
 */

export interface DocComment {
  id: number;
  text: string;
  anchorLink: string;
}

export type CellRecord = SchemaTypes["_grist_Cells"];

export function makeDocComment(commentRowId: number, record: CellRecord): DocComment|null {
  const parsed = safeJsonParse(record.content, {});
  const anchorLink = makeAnchorLinkValue({rowId: record.rowId, colRef: record.colRef});
  if (!parsed.text) { return null; }
  return {
    id: commentRowId,
    text: parsed.text,
    anchorLink,
  };
}

export function extractUserRefsFromComment(comment: DocComment): string[] {
  return [];
}
