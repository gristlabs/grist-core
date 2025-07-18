import {SchemaTypes} from 'app/common/schema';
import {safeJsonParse} from 'app/common/gutil';
import {makeAnchorLinkValue} from 'app/common/gristUrls';

/**
 * Comment data stored in the `content` field of a cell.
 * Notice: this is JSON data created by user, so all fields are not guaranteed to be present or
 * be trusted.
 */
export interface CommentContent {
  /** Text of a comment, safe markdown string as in markdown columns  */
  text: string;
  /**
   * User name of the person who created the comment.
   * Notice: this is rather a signature of the user, not a real user name,
   * it is not guaranteed to be secure, as user might change it through the API.
   */
  userName?: string|null;
  /**
   * Time when the comment was created. Timestamp in milliseconds since epoch.
   */
  timeCreated?: number|null;
  /**
   * Time when the comment was last updated.
   */
  timeUpdated?: number|null;
  /**
   * Whether the comment was marked as resolved.
   */
  resolved?: boolean|null;
  /**
   * User name of the person who resolved the comment, defaults to the user who created it.
   */
  resolvedBy?: string|null;
  /**
   * List of user refs mentioned in the comment. The extraction is done by the client code, so
   * it is not guaranteed to be secure or trusted.
   */
  mentions?: string[]|null;

  /**
   * Id of a section where the comment was created.
   */
  sectionId?: number|null;
}


/**
 * TODO: This is just a skeleton of what we need to extract comment data for notifications
 * purposes.
 */

export interface DocComment {
  id: number;
  text: string;
  anchorLink: string;
  /** Anyone in the comment thread (anyone who replied, commented or was mentioned in a cell) */
  audience: string[]; // List of user refs who are part of the comment thread
  mentions: string[]; // List of user refs mentioned in the comment
}

export type CellRecord = SchemaTypes["_grist_Cells"];

/**
 * Builds a `DocComment` for notifications by parsing cell content, generating an anchor link,
 * and replacing markdown-style mentions with plain text mentions.
 *
 * @param record - Comment's data (a record from _grist_Cell).
 * @param audience - User refs in the comment thread.
 * @param mentions - User refs mentioned in this comment.
 */
export function makeDocComment(
  record: CellRecord,
  audience: string[],
  mentions: string[],
): DocComment|null {
  const parsed = safeJsonParse(record.content, {}) as CommentContent;
  if (!parsed.text) { return null; }
  return {
    id: record.rowId,
    text: replaceMentionsInText(parsed.text),
    anchorLink: makeAnchorLinkValue({
      rowId: record.rowId,
      colRef: record.colRef,
      sectionId: parsed.sectionId ?? undefined,
      comments: true,
    }),
    audience,
    mentions,
  };
}

function replaceMentionsInText(text: string) {
  if (!text) { return text; }
  // Very simple replacement of links mentions.
  // [@user](user:XXXXX) -> @user
  // Also, replace 'nbsp' characters (non-breaking spaces) with regular spaces in this text
  // version. (E.g. in Gmail, they seem to cause 'Message clipped' footer.)
  return text.replace(/\[(@[^\]]+?)\]\(user:\w+\)/g, '$1')
    .replace(/\u00A0/g, ' ');
}

export function getMentions(cellContent: string): string[] {
  const content = safeJsonParse(cellContent, {}) as CommentContent;
  return content.mentions || [];
}
