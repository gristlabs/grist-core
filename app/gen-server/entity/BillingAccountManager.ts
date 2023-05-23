import {BaseEntity, Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn} from 'typeorm';
import {BillingAccount} from 'app/gen-server/entity/BillingAccount';
import {User} from 'app/gen-server/entity/User';

/**
 * A list of users with the right to modify a giving billing account.
 */
@Entity({name: 'billing_account_managers'})
export class BillingAccountManager extends BaseEntity {
  @PrimaryGeneratedColumn()
  public id: number;

  @Column({name: 'billing_account_id', type: Number})
  public billingAccountId: number;

  @ManyToOne(type => BillingAccount, { onDelete: 'CASCADE' })
  @JoinColumn({name: 'billing_account_id'})
  public billingAccount: BillingAccount;

  @Column({name: 'user_id', type: Number})
  public userId: number;

  @ManyToOne(type => User, { onDelete: 'CASCADE' })
  @JoinColumn({name: 'user_id'})
  public user: User;
}
