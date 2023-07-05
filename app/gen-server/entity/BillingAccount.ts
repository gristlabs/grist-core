import {BaseEntity, Column, Entity, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn} from 'typeorm';
import {BillingAccountManager} from 'app/gen-server/entity/BillingAccountManager';
import {Organization} from 'app/gen-server/entity/Organization';
import {Product} from 'app/gen-server/entity/Product';
import {nativeValues} from 'app/gen-server/lib/values';
import {Limit} from 'app/gen-server/entity/Limit';

// This type is for billing account status information.  Intended for stuff
// like "free trial running out in N days".
export interface BillingAccountStatus {
  stripeStatus?: string;
  currentPeriodEnd?: string;
  message?: string;
}

// A structure for billing options relevant to an external authority, for sites
// created outside of Grist's regular billing flow.
export interface ExternalBillingOptions {
  authority: string;   // The name of the external authority.
  invoiceId?: string;  // An id of an invoice or other external billing context.
}

/**
 * This relates organizations to products.  It holds any stripe information
 * needed to be able to update and pay for the product that applies to the
 * organization.  It has a list of managers detailing which users have the
 * right to view and edit these settings.
 */
@Entity({name: 'billing_accounts'})
export class BillingAccount extends BaseEntity {
  @PrimaryGeneratedColumn()
  public id: number;

  @ManyToOne(type => Product)
  @JoinColumn({name: 'product_id'})
  public product: Product;

  @Column({type: Boolean})
  public individual: boolean;

  // A flag for when all is well with the user's subscription.
  // Probably shouldn't use this to drive whether service is provided or not.
  // Strip recommends updating an end-of-service datetime every time payment
  // is received, adding on a grace period of some days.
  @Column({name: 'in_good_standing', type: Boolean, default: nativeValues.trueValue})
  public inGoodStanding: boolean;

  @Column({type: nativeValues.jsonEntityType, nullable: true})
  public status: BillingAccountStatus;

  @Column({name: 'stripe_customer_id', type: String, nullable: true})
  public stripeCustomerId: string | null;

  @Column({name: 'stripe_subscription_id', type: String, nullable: true})
  public stripeSubscriptionId: string | null;

  @Column({name: 'stripe_plan_id', type: String, nullable: true})
  public stripePlanId: string | null;

  @Column({name: 'external_id', type: String, nullable: true})
  public externalId: string | null;

  @Column({name: 'external_options', type: nativeValues.jsonEntityType, nullable: true})
  public externalOptions: ExternalBillingOptions | null;

  @OneToMany(type => BillingAccountManager, manager => manager.billingAccount)
  public managers: BillingAccountManager[];

  @OneToMany(type => Organization, org => org.billingAccount)
  public orgs: Organization[];

  @OneToMany(type => Limit, limit => limit.billingAccount)
  public limits: Limit[];

  // A calculated column that is true if it looks like there is a paid plan.
  @Column({name: 'paid', type: 'boolean', insert: false, select: false})
  public paid?: boolean;

  // A calculated column summarizing whether active user is a manager of the billing account.
  // (No @Column needed since calculation is done in javascript not sql)
  public isManager?: boolean;
}
