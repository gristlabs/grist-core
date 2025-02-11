import {makeId} from 'app/server/lib/idUtils';
import {Activation} from 'app/gen-server/entity/Activation';
import {HomeDBManager} from 'app/gen-server/lib/homedb/HomeDBManager';
import {EntityManager} from 'typeorm';

/**
 * Manage activations. Not much to do currently, there is at most one
 * activation. The activation singleton establishes an id and creation
 * time for the installation.
 */
export class ActivationsManager {
  constructor(private _db: HomeDBManager) {
  }

  public async runInTransaction<T>(fn: (transaction: EntityManager) => Promise<T>): Promise<T> {
    return this._db.runInTransaction(undefined, fn);
  }

  // Get the current activation row, creating one if necessary.
  // It will be created with an empty key column, which will get
  // filled in once an activation key is presented.
  public async current(transaction?: EntityManager): Promise<Activation> {
    return await this._db.runInTransaction(transaction, async manager => {
      let activation = await manager.findOne(Activation, {where: {}});
      if (!activation) {
        activation = manager.create(Activation);
        activation.id = makeId();
        activation.prefs = {};
        await activation.save();
      }
      return activation;
    });
  }

  public async setKey(key: string, transaction?: EntityManager): Promise<void> {
    await this._updateActivation(activation => {
      activation.key = key;
    }, transaction);
  }


  public async updateGracePeriod(gracePeriodStarted: Date | null, transaction?: EntityManager): Promise<void> {
    await this._updateActivation(activation => {
      activation.gracePeriodStart = gracePeriodStarted;
    }, transaction);
  }

  public async memberCount(transaction?: EntityManager): Promise<number> {
    return await this._db.runInTransaction(transaction, async manager => {
      const userManager = this._db.usersManager();
      const excludedUsers = userManager.getExcludedUserIds();
      const {count} = await manager
        .createQueryBuilder()
        .select('CAST(COUNT(*) AS INTEGER)', 'count') // Cast to integer for postgres, which returns strings.
        .from(qb => {
          const sub = qb
            .select('DISTINCT u.id', 'id')
            .from('acl_rules', 'a')
            .innerJoin('groups', 'g', 'a.group_id = g.id')
            .innerJoin('orgs', 'o', 'a.org_id = o.id')
            .innerJoin('group_users', 'gu', 'g.id = gu.group_id')
            .innerJoin('users', 'u', 'gu.user_id = u.id');

          if (process.env.GRIST_SINGLE_ORG === 'docs') {
            // Count only personal orgs.
            return sub
              .where('o.owner_id = u.id')
              .andWhere('u.id NOT IN (:...excludedUsers)', {excludedUsers});
          } else if (process.env.GRIST_SINGLE_ORG) {
            // Count users of this single org.
            return sub
              .where('o.owner_id IS NULL')
              .andWhere('o.domain = :domain', {domain: process.env.GRIST_SINGLE_ORG})
              .andWhere('u.id NOT IN (:...excludedUsers)', {excludedUsers});
          } else {
            // Count users of all teams except personal.
            return sub
              .where('o.owner_id IS NULL')
              .andWhere('u.id NOT IN (:...excludedUsers)', {excludedUsers});
          }
        }, 'subquery')
        .getRawOne();
      return count;
    });
  }

  private async _updateActivation(fn: (activation: Activation) => void, transaction?: EntityManager): Promise<void> {
    await this._db.runInTransaction(transaction, async manager => {
      const activation = await this.current(manager);
      fn(activation);
      await manager.save(activation);
    });
  }
}
