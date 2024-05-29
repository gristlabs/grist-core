import {getTableId} from 'app/common/DocActions';
import {EmptyRecordView, RecordView} from 'app/common/RecordView';
import {Role} from 'app/common/roles';

/**
 * Information about a user, including any user attributes.
 */
export interface UserInfo {
  Name: string | null;
  Email: string | null;
  Access: Role | null;
  Origin: string | null;
  LinkKey: Record<string, string | undefined>;
  UserID: number | null;
  UserRef: string | null;
  SessionID: string | null;
  /**
   * This is a rowId in the _grist_Shares table, if the user is accessing a document
   * via a share. Otherwise null.
   */
  ShareRef: number | null;
  [attributes: string]: unknown;
}

/**
 * Wrapper class for `UserInfo`.
 *
 * Contains methods for converting itself to different representations.
 */
export class User implements UserInfo {
  public Name: string | null = null;
  public UserID: number | null = null;
  public Access: Role | null = null;
  public Origin: string | null = null;
  public LinkKey: Record<string, string | undefined> = {};
  public Email: string | null = null;
  public SessionID: string | null = null;
  public UserRef: string | null = null;
  public ShareRef: number | null = null;
  [attribute: string]: any;

  constructor(info: Record<string, unknown> = {}) {
    Object.assign(this, info);
  }

  /**
   * Returns a JSON representation of this class that excludes full row data,
   * only keeping user info and table/row ids for any user attributes.
   *
   * Used by the sandbox to support `user` variables in formulas (see `user.py`).
   */
  public toJSON() {
    return this._toObject((value) => {
      if (value instanceof RecordView) {
        return [getTableId(value.data), value.get('id')];
      } else if (value instanceof EmptyRecordView) {
        return null;
      } else {
        return value;
      }
    });
  }

  /**
   * Returns a record representation of this class, with all user attributes
   * converted from `RecordView` instances to their JSON representations.
   *
   * Used by the client to support `user` variables in dropdown conditions.
   */
  public toUserInfo(): UserInfo {
    return this._toObject((value) => {
      if (value instanceof RecordView) {
        return value.toJSON();
      } else if (value instanceof EmptyRecordView) {
        return null;
      } else {
        return value;
      }
    }) as UserInfo;
  }

  private _toObject(mapValue: (value: unknown) => unknown) {
    const results: {[key: string]: any} = {};
    for (const [key, value] of Object.entries(this)) {
      results[key] = mapValue(value);
    }
    return results;
  }
}
