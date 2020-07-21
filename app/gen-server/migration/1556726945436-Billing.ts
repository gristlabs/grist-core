import {MigrationInterface, QueryRunner, Table, TableColumn, TableForeignKey} from 'typeorm';
import {BillingAccount} from 'app/gen-server/entity/BillingAccount';
import {BillingAccountManager} from 'app/gen-server/entity/BillingAccountManager';
import {Organization} from 'app/gen-server/entity/Organization';
import {Product} from 'app/gen-server/entity/Product';
import {nativeValues} from 'app/gen-server/lib/values';

export class Billing1556726945436 implements MigrationInterface {

  public async up(queryRunner: QueryRunner): Promise<any> {
    // Create table for products.
    await queryRunner.createTable(new Table({
      name: 'products',
      columns: [
        {
          name: 'id',
          type: 'integer',
          isGenerated: true,
          generationStrategy: 'increment',
          isPrimary: true
        },
        {
          name: 'name',
          type: 'varchar'
        },
        {
          name: 'stripe_product_id',
          type: 'varchar',
          isUnique: true,
          isNullable: true
        },
        {
          name: 'features',
          type: nativeValues.jsonType
        }
      ]
    }));

    // Create a basic free product that existing orgs can use.
    const product = new Product();
    product.name = 'Free';
    product.features = {};
    await queryRunner.manager.save(product);

    // Create billing accounts and billing account managers.
    await queryRunner.createTable(new Table({
      name: 'billing_accounts',
      columns: [
        {
          name: 'id',
          type: 'integer',
          isGenerated: true,
          generationStrategy: 'increment',
          isPrimary: true
        },
        {
          name: 'product_id',
          type: 'integer'
        },
        {
          name: 'individual',
          type: nativeValues.booleanType
        },
        {
          name: 'in_good_standing',
          type: nativeValues.booleanType,
          default: nativeValues.trueValue
        },
        {
          name: 'status',
          type: nativeValues.jsonType,
          isNullable: true
        },
        {
          name: 'stripe_customer_id',
          type: 'varchar',
          isUnique: true,
          isNullable: true
        },
        {
          name: 'stripe_subscription_id',
          type: 'varchar',
          isUnique: true,
          isNullable: true
        },
        {
          name: 'stripe_plan_id',
          type: 'varchar',
          isNullable: true
        }
      ],
      foreignKeys: [
        {
          columnNames: ['product_id'],
          referencedColumnNames: ['id'],
          referencedTableName: 'products'
        }
      ]
    }));

    await queryRunner.createTable(new Table({
      name: 'billing_account_managers',
      columns: [
        {
          name: 'id',
          type: 'integer',
          isGenerated: true,
          generationStrategy: 'increment',
          isPrimary: true
        },
        {
          name: 'billing_account_id',
          type: 'integer'
        },
        {
          name: 'user_id',
          type: 'integer'
        }
      ],
      foreignKeys: [
        {
          columnNames: ['billing_account_id'],
          referencedColumnNames: ['id'],
          referencedTableName: 'billing_accounts',
          onDelete: 'CASCADE'  // delete manager if referenced billing_account goes away
        },
        {
          columnNames: ['user_id'],
          referencedColumnNames: ['id'],
          referencedTableName: 'users',
          onDelete: 'CASCADE'  // delete manager if referenced user goes away
        }
      ]
    }));

    // Add a reference to billing accounts from orgs.
    await queryRunner.addColumn('orgs', new TableColumn({
        name: 'billing_account_id',
        type: 'integer',
        isNullable: true
    }));
    await queryRunner.createForeignKey('orgs', new TableForeignKey({
      columnNames: ['billing_account_id'],
      referencedColumnNames: ['id'],
      referencedTableName: 'billing_accounts'
    }));

    // Let's add billing accounts to all existing orgs.
    // Personal orgs are put on an individual billing account.
    // Other orgs are put on a team billing account, with the
    // list of payment managers seeded by owners of that account.
    const query =
      queryRunner.manager.createQueryBuilder()
      .select('orgs.id')
      .from(Organization, 'orgs')
      .leftJoin('orgs.owner', 'owners')
      .addSelect('orgs.owner.id')
      .leftJoinAndSelect('orgs.aclRules', 'acl_rules')
      .leftJoinAndSelect('acl_rules.group', 'groups')
      .leftJoin('groups.memberUsers', 'users')
      .addSelect('users.id')
      .where('permissions & 8 = 8');  // seed managers with owners+editors, omitting guests+viewers
                                      // (permission 8 is "Remove")
    const orgs = await query.getMany();
    for (const org of orgs) {
      const individual = Boolean(org.owner);
      const billingAccountInsert = await queryRunner.manager.createQueryBuilder()
        .insert()
        .into(BillingAccount)
        .values([{product, individual}])
        .execute();
      const billingAccountId = billingAccountInsert.identifiers[0].id;
      if (individual) {
        await queryRunner.manager.createQueryBuilder()
          .insert()
          .into(BillingAccountManager)
          .values([{billingAccountId, userId: org.owner.id}])
          .execute();
      } else {
        for (const rule of org.aclRules) {
          for (const user of rule.group.memberUsers) {
            await queryRunner.manager.createQueryBuilder()
              .insert()
              .into(BillingAccountManager)
              .values([{billingAccountId, userId: user.id}])
              .execute();
          }
        }
      }
      await queryRunner.manager.createQueryBuilder()
        .update(Organization)
        .set({billingAccountId})
        .where('id = :id', {id: org.id})
        .execute();
    }

    // TODO: in a future migration, orgs.billing_account_id could be constrained
    // to be non-null.  All code deployments linked to a database that will be
    // migrated must have code that sets orgs.billing_account_id by that time,
    // otherwise they would fail to create orgs (and remember creating a user
    // involves creating an org).
    /*
    // Now that all orgs have a billing account (and this migration is running within
    // a transaction), we can constrain orgs.billing_account_id to be non-null.
    const orgTable = (await queryRunner.getTable('orgs'))!;
    const billingAccountId = orgTable.findColumnByName('billing_account_id')!;
    const billingAccountIdNonNull = billingAccountId.clone();
    billingAccountIdNonNull.isNullable = false;
    await queryRunner.changeColumn('orgs', billingAccountId, billingAccountIdNonNull);
    */
  }

  public async down(queryRunner: QueryRunner): Promise<any> {
    // this is a bit ugly, but is the documented way to remove a foreign key
    const table = await queryRunner.getTable('orgs');
    const foreignKey = table!.foreignKeys.find(fk => fk.columnNames.indexOf('billing_account_id') !== -1);
    await queryRunner.dropForeignKey('orgs', foreignKey!);

    await queryRunner.dropColumn('orgs', 'billing_account_id');
    await queryRunner.dropTable('billing_account_managers');
    await queryRunner.dropTable('billing_accounts');
    await queryRunner.dropTable('products');
  }

}
