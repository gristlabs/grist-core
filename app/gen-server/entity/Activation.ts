import {InstallPrefs} from "app/common/Install";
import {ApiError} from "app/common/ApiError";
import {InstallProperties, installPropertyKeys} from "app/common/InstallAPI";
import {nativeValues} from "app/gen-server/lib/values";
import {BaseEntity, Column, Entity, PrimaryColumn} from "typeorm";

@Entity({name: 'activations'})
export class Activation extends BaseEntity {

  @PrimaryColumn()
  public id: string;

  @Column({name: 'key', type: 'text', nullable: true})
  public key: string|null;

  @Column({type: nativeValues.jsonEntityType, nullable: true})
  public prefs: InstallPrefs|null;

  @Column({name: 'created_at', default: () => "CURRENT_TIMESTAMP"})
  public createdAt: Date;

  @Column({name: 'updated_at', default: () => "CURRENT_TIMESTAMP"})
  public updatedAt: Date;

  // When the enterprise activation was first enabled, so we know when
  // to start counting the trial date.
  //
  // Activations are created at Grist installation to track other
  // things such as prefs, but the user might not enable Enterprise
  // until later.
  @Column({name: 'enabled_at', type: nativeValues.dateTimeType, nullable: true})
  public enabledAt: Date|null;

  // When this installation entered into grace period, due to key expiration or limits exceeded.
  @Column({name: 'grace_period_start', type: nativeValues.dateTimeType, nullable: true})
  public gracePeriodStart: Date|null;

  public checkProperties(props: any): props is Partial<InstallProperties> {
    for (const key of Object.keys(props)) {
      if (!installPropertyKeys.includes(key)) {
        throw new ApiError(`Unrecognized property ${key}`, 400);
      }
    }
    return true;
  }

  public updateFromProperties(props: Partial<InstallProperties>) {
    if (props.prefs === undefined) { return; }

    if (props.prefs === null) {
      this.prefs = null;
    } else {
      this.prefs = this.prefs || {};
      if (props.prefs.telemetry !== undefined) {
        this.prefs.telemetry = this.prefs.telemetry || {};
        if (props.prefs.telemetry.telemetryLevel !== undefined) {
          this.prefs.telemetry.telemetryLevel = props.prefs.telemetry.telemetryLevel;
        }
      }

      for (const key of Object.keys(this.prefs) as Array<keyof InstallPrefs>) {
        if (this.prefs[key] === null) {
          delete this.prefs[key];
        }
      }

      if (Object.keys(this.prefs).length === 0) {
        this.prefs = null;
      }
    }
  }
}
