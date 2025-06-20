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
}
