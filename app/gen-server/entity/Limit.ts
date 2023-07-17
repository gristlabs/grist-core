import {BaseEntity, Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn} from 'typeorm';
import {BillingAccount} from 'app/gen-server/entity/BillingAccount';
import {nativeValues} from 'app/gen-server/lib/values';

@Entity('limits')
export class Limit extends BaseEntity {
  @PrimaryGeneratedColumn()
  public id: number;

  @Column({type: Number})
  public limit: number;

  @Column({type: Number})
  public usage: number;

  @Column({type: String})
  public type: string;

  @Column({name: 'billing_account_id', type: Number})
  public billingAccountId: number;

  @ManyToOne(type => BillingAccount)
  @JoinColumn({name: 'billing_account_id'})
  public billingAccount: BillingAccount;

  @Column({name: 'created_at', type: nativeValues.dateTimeType, default: () => "CURRENT_TIMESTAMP"})
  public createdAt: Date;

  /**
   * Last time the Limit.limit value was changed, by an upgrade or downgrade. Null if it has never been changed.
   */
  @Column({name: 'changed_at', type: nativeValues.dateTimeType, nullable: true})
  public changedAt: Date|null;

  /**
   * Last time the Limit.usage was used (by sending a request to the model). Null if it has never been used.
   */
  @Column({name: 'used_at', type: nativeValues.dateTimeType, nullable: true})
  public usedAt: Date|null;

  /**
   * Last time the Limit.usage was reset, probably by billing cycle change. Null if it has never been reset.
   */
  @Column({name: 'reset_at', type: nativeValues.dateTimeType, nullable: true})
  public resetAt: Date|null;
}
