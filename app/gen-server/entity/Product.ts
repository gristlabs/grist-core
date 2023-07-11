import {Features, Product as IProduct, PERSONAL_FREE_PLAN, PERSONAL_LEGACY_PLAN, TEAM_FREE_PLAN,
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
 * A summary of features used in 'team' plans.
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

export const testDailyApiLimitFeatures = {
  ...teamFreeFeatures,
  baseMaxApiUnitsPerDocumentPerDay: 3,
};

/**
 * A summary of features used in unrestricted grandfathered accounts, and also
 * in some test settings.
 */
export const grandfatherFeatures: Features = {
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
 * Products are a bundle of enabled features.  Most products in
 * Grist correspond to products in stripe.  The correspondence is
 * established by a gristProduct metadata field on stripe plans.
 *
 * In addition, there are the following products in Grist that don't
 * exist in stripe:
 *   - The product named 'Free'.  This is a product used for organizations
 *     created prior to the billing system being set up.
 *   - The product named 'stub'.  This is product assigned to new
 *     organizations that should not be usable until a paid plan
 *     is set up for them.
 *
 * TODO: change capitalization of name of grandfather product.
 *
 */
export const PRODUCTS: IProduct[] = [
  // This is a product for grandfathered accounts/orgs.
  {
    name: 'Free',
    features: grandfatherFeatures,
  },

  // This is a product for newly created accounts/orgs.
  {
    name: 'stub',
    features: {},
  },
  // This is a product for legacy personal accounts/orgs.
  {
    name: PERSONAL_LEGACY_PLAN,
    features: personalLegacyFeatures,
  },
  {
    name: 'professional',  // deprecated, can be removed once no longer referred to in stripe.
    features: teamFeatures,
  },
  {
    name: TEAM_PLAN,
    features: teamFeatures
  },

  // This is a product for a team site that is no longer in good standing, but isn't yet
  // to be removed / deactivated entirely.
  {
    name: 'suspended',
    features: suspendedFeatures
  },
  {
    name: TEAM_FREE_PLAN,
    features: teamFreeFeatures
  },
  {
    name: PERSONAL_FREE_PLAN,
    features: personalFreeFeatures,
  },
];


/**
 * Get names of products for different situations.
 */
export function getDefaultProductNames() {
  const defaultProduct = process.env.GRIST_DEFAULT_PRODUCT;
  // TODO: can be removed once new deal is released.
  const personalFreePlan = PERSONAL_FREE_PLAN;
  return {
    // Personal site start off on a functional plan.
    personal: defaultProduct || personalFreePlan,
     // Team site starts off on a limited plan, requiring subscription.
    teamInitial: defaultProduct || 'stub',
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
