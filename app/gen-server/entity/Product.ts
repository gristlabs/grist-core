import {Features, FREE_PLAN,
        Product as IProduct,
        isManagedPlan,
        PERSONAL_FREE_PLAN,
        PERSONAL_LEGACY_PLAN,
        STUB_PLAN,
        SUSPENDED_PLAN,
        TEAM_FREE_PLAN,
        TEAM_PLAN} from 'app/common/Features';
import {nativeValues} from 'app/gen-server/lib/values';
import * as assert from 'assert';
import {BillingAccount} from 'app/gen-server/entity/BillingAccount';
import {BaseEntity, Column, Connection, Entity, OneToMany, PrimaryGeneratedColumn} from 'typeorm';

/**
 * A summary of features available in legacy personal sites.
 */
export const personalLegacyFeatures: Features = {
  workspaces: true,
  // no vanity domain
  maxDocsPerOrg: 10,
  maxSharesPerDoc: 2,
  maxWorkspacesPerOrg: 1,
  /**
   * One time limit of 100 requests.
   */
  baseMaxAssistantCalls: 100,
};

/**
 * A summary of features used in 'team' plans. Grist ensures that this plan exists in the database, but it
 * is treated as an external plan that came from Stripe, and is not modified by Grist.
 */
export const teamFeatures: Features = {
  workspaces: true,
  vanityDomain: true,
  maxSharesPerWorkspace: 0,   // all workspace shares need to be org members.
  maxSharesPerDoc: 2,
  /**
   * Limit of 100 requests, but unlike for personal/free orgs the usage for this limit is reset at every billing cycle
   * through Stripe webhook. For canceled subscription the usage is not reset, as the billing cycle is not changed.
   */
  baseMaxAssistantCalls: 100,
};

/**
 * A summary of features available in free team sites.
 */
export const teamFreeFeatures: Features = {
  workspaces: true,
  vanityDomain: true,
  maxSharesPerWorkspace: 0,   // all workspace shares need to be org members.
  maxSharesPerDoc: 2,
  snapshotWindow: { count: 30, unit: 'days' },
  baseMaxRowsPerDocument: 5000,
  baseMaxApiUnitsPerDocumentPerDay: 5000,
  baseMaxDataSizePerDocument: 5000 * 2 * 1024,  // 2KB per row
  baseMaxAttachmentsBytesPerDocument: 1 * 1024 * 1024 * 1024,  // 1GB
  gracePeriodDays: 14,
  /**
   * One time limit of 100 requests.
   */
  baseMaxAssistantCalls: 100,
};

/**
 * A summary of features available in free personal sites.
 */
 export const personalFreeFeatures: Features = {
  workspaces: true,
  maxSharesPerWorkspace: 0,   // workspace sharing is disabled.
  maxSharesPerDoc: 2,
  snapshotWindow: { count: 30, unit: 'days' },
  baseMaxRowsPerDocument: 5000,
  baseMaxApiUnitsPerDocumentPerDay: 5000,
  baseMaxDataSizePerDocument: 5000 * 2 * 1024,  // 2KB per row
  baseMaxAttachmentsBytesPerDocument: 1 * 1024 * 1024 * 1024,  // 1GB
  gracePeriodDays: 14,
  baseMaxAssistantCalls: 100,
};

/**
 * A summary of features used in unrestricted grandfathered accounts, and also
 * in some test settings.
 */
export const freeAllFeatures: Features = {
  workspaces: true,
  vanityDomain: true,
};

export const suspendedFeatures: Features = {
  workspaces: true,
  vanityDomain: true,
  readOnlyDocs: true,
  // clamp down on new docs/workspaces/shares
  maxDocsPerOrg: 0,
  maxSharesPerDoc: 0,
  maxWorkspacesPerOrg: 0,
  baseMaxAssistantCalls: 0,
};

/**
 *
 * Products are a bundle of enabled features. Grist knows only
 * about free products and creates them by default. Other products
 * are created by the billing system (Stripe) and synchronized when used
 * or via webhooks.
 */
export const PRODUCTS: IProduct[] = [
  {
    name: PERSONAL_LEGACY_PLAN,
    features: personalLegacyFeatures,
  },
  {
    name: PERSONAL_FREE_PLAN,
    features: personalFreeFeatures, // those features are read from database, here are only as a reference.
  },
  {
    name: TEAM_FREE_PLAN,
    features: teamFreeFeatures,
  },
  // This is a product for a team site (used in tests mostly, as the real team plan is managed by Stripe).
  {
    name: TEAM_PLAN,
    features: teamFeatures
  },
  // This is a product for a team site that is no longer in good standing, but isn't yet
  // to be removed / deactivated entirely.
  {
    name: SUSPENDED_PLAN,
    features: suspendedFeatures,
  },
  {
    name: FREE_PLAN,
    features: freeAllFeatures,
  },
  // This is a product for newly created accounts/orgs.
  {
    name: STUB_PLAN,
    features: {},
  }
];


/**
 * Get names of products for different situations.
 */
export function getDefaultProductNames() {
  const defaultProduct = process.env.GRIST_DEFAULT_PRODUCT;
  return {
    // Personal site start off on a functional plan.
    personal: defaultProduct || PERSONAL_FREE_PLAN,
     // Team site starts off on a limited plan, requiring subscription.
    teamInitial: defaultProduct || STUB_PLAN,
    // Team site that has been 'turned off'.
    teamCancel: 'suspended',
    // Functional team site.
    team: defaultProduct || TEAM_PLAN,
    teamFree: defaultProduct || TEAM_FREE_PLAN,
  };
}

/**
 * A Grist product.  Corresponds to a set of enabled features and a choice of limits.
 */
@Entity({name: 'products'})
export class Product extends BaseEntity {
  @PrimaryGeneratedColumn()
  public id: number;

  @Column({type: String})
  public name: string;

  @Column({type: nativeValues.jsonEntityType})
  public features: Features;

  @OneToMany(type => BillingAccount, account => account.product)
  public accounts: BillingAccount[];
}

/**
 * Make sure the products defined for the current stripe setup are
 * in the database and up to date.  Other products in the database
 * are untouched.
 *
 * If `apply` is set, the products are changed in the db, otherwise
 * the are left unchanged.  A summary of affected products is returned.
 */
export async function synchronizeProducts(
  connection: Connection, apply: boolean, products = PRODUCTS
): Promise<string[]> {
  try {
    await connection.query('select name, features, stripe_product_id from products limit 1');
  } catch (e) {
    // No usable products table, do not try to synchronize.
    return [];
  }
  const changingProducts: string[] = [];
  await connection.transaction(async transaction => {
    const desiredProducts = new Map(products.map(p => [p.name, p]));
    const existingProducts = new Map((await transaction.find(Product))
                                     .map(p => [p.name, p]));
    for (const product of desiredProducts.values()) {
      if (existingProducts.has(product.name)) {

        // Synchronize features only of known plans (team plan is not known).
        if (!isManagedPlan(product.name)) {
          continue;
        }

        const p = existingProducts.get(product.name)!;
        try {
          assert.deepStrictEqual(p.features, product.features);
        } catch (e) {
          if (apply) {
            p.features = product.features;
            await transaction.save(p);
          }
          changingProducts.push(p.name);
        }
      } else {
        if (apply) {
          const p = new Product();
          p.name = product.name;
          p.features = product.features;
          await transaction.save(p);
        }
        changingProducts.push(product.name);
      }
    }
  });
  return changingProducts;
}
