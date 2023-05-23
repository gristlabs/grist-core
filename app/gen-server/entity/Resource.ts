import {BaseEntity, Column} from "typeorm";
import {ApiError} from 'app/common/ApiError';
import {CommonProperties} from "app/common/UserAPI";

export class Resource extends BaseEntity {
  @Column({type: String})
  public name: string;

  @Column({name: 'created_at', type: Date, default: () => "CURRENT_TIMESTAMP"})
  public createdAt: Date;

  @Column({name: 'updated_at', type: Date, default: () => "CURRENT_TIMESTAMP"})
  public updatedAt: Date;

  // a computed column which, when present, means the entity should be filtered out
  // of results.
  @Column({name: 'filtered_out', type: 'boolean', select: false, insert: false})
  public filteredOut?: boolean;

  public updateFromProperties(props: Partial<CommonProperties>) {
    if (props.createdAt) { this.createdAt = _propertyToDate(props.createdAt); }
    if (props.updatedAt) {
      this.updatedAt = _propertyToDate(props.updatedAt);
    } else {
      this.updatedAt = new Date();
    }
    if (props.name) { this.name = props.name; }
  }

  protected checkProperties(props: any, keys: string[]): props is Partial<CommonProperties> {
    for (const key of Object.keys(props)) {
      if (!keys.includes(key)) {
        throw new ApiError(`unrecognized property ${key}`, 400);
      }
    }
    return true;
  }
}

// Ensure iso-string-or-date value is converted to a date.
function _propertyToDate(d: string|Date): Date {
  if (typeof(d) === 'string') {
    return new Date(d);
  }
  return d;
}
