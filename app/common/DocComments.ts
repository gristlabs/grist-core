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

type MentionChunk =
  | string
  | { name: string; ref: string };

const mentionRegex = /\[(@[^\]]+?)\]\(user:(\w+)\)/;

/**
 * Splits a string into chunks of plain text and mention objects.
 * Each mention is of the form [@name](user:ref).
 *
 * Example:
 *   Input: "Hello [@Alice](user:123) and [@Bob](user:456)"
 *   Output:
 *     [
 *       "Hello ",
 *       { name: "@Alice", ref: "123" },
 *       " and ",
 *       { name: "@Bob", ref: "456" }
 *     ]
 *
 *    Input: "No mentions here"
 *    Output: ["No mentions here"]
 *
 *    Input: "[@Alice](user:123)"
 *    Output: [{ name: "@Alice", ref: "123" }]
 */
export function splitTextWithMentions(text: string): MentionChunk[] {
  if (!text) { return []; }

  // Use split to divide the string by mentionRegex, the result will look like:
  // for single mention [text1, name1, ref1, text2]
  // for no mentions [text1] if there are no mentions
  // for multiple mentions [text1, name1, ref1, text2, name2, ref2, text3]
  const parts = text.split(mentionRegex);
  const chunks: MentionChunk[] = [];
  for (let i = 0; i < parts.length; i += 3) {
    // Always push the plain text part
    if (parts[i]) {
      chunks.push(parts[i]);
    }

    // If there is anything after the text part, it should be a mention
    if (i + 2 < parts.length) {
      const name = parts[i + 1];
      const ref = parts[i + 2];
      chunks.push({ name, ref });
    }
  }

  return chunks;
}

function replaceMentionsInText(text: string) {
  // Very simple replacement of links mentions.
  // [@user](user:XXXXX) -> @user
  // Also, replace 'nbsp' characters (non-breaking spaces) with regular spaces in this text
  // version. (E.g. in Gmail, they seem to cause 'Message clipped' footer.)
  return splitTextWithMentions(text)
    .map(chunk => typeof chunk === 'string' ? chunk : chunk.name)
    .join('')
    .replace(/\u00A0/g, ' ');
}

export function getMentions(cellContent: string): string[] {
  const content = safeJsonParse(cellContent, {}) as CommentContent;
  return content.mentions || [];
}
