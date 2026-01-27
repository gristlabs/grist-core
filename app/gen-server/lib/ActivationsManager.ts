import { InstallPrefs } from "app/common/Install";
import { InstallPrefsWithSources } from "app/common/InstallAPI";
import { Activation } from "app/gen-server/entity/Activation";
import { HomeDBManager } from "app/gen-server/lib/homedb/HomeDBManager";
import { makeId } from "app/server/lib/idUtils";
import { getTelemetryPrefs } from "app/server/lib/Telemetry";

import pick from "lodash/pick";
import { EntityManager } from "typeorm";

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
    return await this._db.runInTransaction(transaction, async (manager) => {
      let activation = await manager.findOne(Activation, { where: {} });
      if (!activation) {
        activation = manager.create(Activation);
        activation.id = makeId();
        activation.prefs = { checkForLatestVersion: true };
        await activation.save();
      }
      return activation;
    });
  }

  public async setKey(key: string, transaction?: EntityManager): Promise<void> {
    await this._updateActivation((activation) => {
      activation.key = key;
    }, transaction);
  }

  public async updateGracePeriod(gracePeriodStarted: Date | null, transaction?: EntityManager): Promise<void> {
    await this._updateActivation((activation) => {
      activation.gracePeriodStart = gracePeriodStarted;
    }, transaction);
  }

  public async memberCount(transaction?: EntityManager): Promise<number> {
    return await this._db.runInTransaction(transaction, async (manager) => {
      const userManager = this._db.usersManager();
      const excludedUsers = userManager.getExcludedUserIds();
      const { count } = await manager
        .createQueryBuilder()
        .select("CAST(COUNT(*) AS INTEGER)", "count") // Cast to integer for postgres, which returns strings.
        .from((qb) => {
          const sub = qb
            .select("DISTINCT u.id", "id")
            .from("acl_rules", "a")
            .innerJoin("groups", "g", "a.group_id = g.id")
            .innerJoin("orgs", "o", "a.org_id = o.id")
            .innerJoin("group_users", "gu", "g.id = gu.group_id")
            .innerJoin("users", "u", "gu.user_id = u.id");

          if (process.env.GRIST_SINGLE_ORG === "docs") {
            // Count only personal orgs.
            return sub
              .where("o.owner_id = u.id")
              .andWhere("u.id NOT IN (:...excludedUsers)", { excludedUsers });
          }
          else if (process.env.GRIST_SINGLE_ORG) {
            // Count users of this single org.
            return sub
              .where("o.owner_id IS NULL")
              .andWhere("o.domain = :domain", { domain: process.env.GRIST_SINGLE_ORG })
              .andWhere("u.id NOT IN (:...excludedUsers)", { excludedUsers });
          }
          else {
            // Count users of all teams except personal.
            return sub
              .where("o.owner_id IS NULL")
              .andWhere("u.id NOT IN (:...excludedUsers)", { excludedUsers });
          }
        }, "subquery")
        .getRawOne();
      return count;
    });
  }

  /**
   * Updates a key/value pair in the app env file stored in the activation record.
   * TODO: Notify other servers that the env file has changed and they should refresh their copy of appSettings.
   */
  public async updateAppEnvFile(delta: Record<string, string | null>, transaction?: EntityManager) {
    return await this._db.runInTransaction(transaction, async (manager) => {
      const activation = await this.current(manager);
      activation.prefs ??= {};
      activation.prefs.envVars ??= {};
      // For now we just support 3 keys here, as these ones are tested.
      Object.assign(activation.prefs.envVars, pick(delta,
        "GRIST_LOGIN_SYSTEM_TYPE",
        "GRIST_GETGRISTCOM_SECRET",
        "GRIST_DEFAULT_EMAIL",
      ));
      // If any values are undefined or null, remove them.
      for (const key of Object.keys(delta)) {
        if (delta[key] === null || delta[key] === undefined) {
          delete activation.prefs.envVars[key];
        }
      }
      await manager.save(activation);
    });
  }

  /**
   * Returns all prefs with their sources, if applicable.
   */
  public async getPrefs(): Promise<InstallPrefsWithSources> {
    const activation = await this.current();
    const telemetryPrefs = await getTelemetryPrefs(this._db, activation);
    const prefs = activation.prefs || {};
    const { onRestartSetDefaultEmail, onRestartReplaceEmailWithAdmin } = prefs;
    return {
      telemetry: telemetryPrefs,
      checkForLatestVersion: activation.prefs?.checkForLatestVersion ?? true,
      onRestartSetDefaultEmail,
      onRestartReplaceEmailWithAdmin,
    };
  }

  /**
   * Updates the specified `prefs`.
   */
  public async updatePrefs(prefs: Partial<InstallPrefs>): Promise<void> {
    await this._updateActivation((activation) => {
      const props = { prefs };
      activation.checkProperties(props);
      activation.updateFromProperties(props);
    });
  }

  /**
   * Deletes the specified `prefs`.
   *
   * Returns the deleted prefs, excluding any that were not found.
   */
  public async deletePrefs(
    prefs: (keyof InstallPrefs)[],
    { transaction }: { transaction?: EntityManager } = {},
  ): Promise<Partial<InstallPrefs>> {
    return await this._db.runInTransaction(transaction, async (manager) => {
      const activation = await this.current(manager);
      activation.prefs ??= {};
      const deletedPrefs: Partial<InstallPrefs> = {};
      for (const pref of prefs) {
        if (pref in activation.prefs) {
          deletedPrefs[pref] = activation.prefs[pref] as any;
          delete activation.prefs[pref];
        }
      }
      if (Object.keys(deletedPrefs).length > 0) {
        await manager.save(activation);
      }
      return deletedPrefs;
    });
  }

  private async _updateActivation(fn: (activation: Activation) => void, transaction?: EntityManager): Promise<void> {
    await this._db.runInTransaction(transaction, async (manager) => {
      const activation = await this.current(manager);
      fn(activation);
      await manager.save(activation);
    });
  }
}
