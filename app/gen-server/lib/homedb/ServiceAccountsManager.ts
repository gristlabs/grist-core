import { HomeDBManager } from 'app/gen-server/lib/homedb/HomeDBManager';
import { EntityManager } from 'typeorm';
import {v4 as uuidv4} from 'uuid';
import { ServiceAccount } from 'app/gen-server/entity/ServiceAccount';
import { ApiError } from 'app/common/ApiError';

export class ServiceAccountsManager {

  private get _connection () {
    return this._homeDb.connection;
  }

  public constructor(
    private readonly _homeDb: HomeDBManager,
    //private _runInTransaction: RunInTransaction
  ) {}

  // This method is implemented for test purpose only
  // Using it outside of tests context will lead to partial db
  // destruction
  public async deleteAllServiceAccounts(optManager?: EntityManager){
    const manager = optManager || new EntityManager(this._connection);
    const queryBuilder = manager.createQueryBuilder()
      .delete()
      .from(ServiceAccount, 'service_accounts');
    return await queryBuilder.execute();
  }

  public async createServiceAccount(
    ownerId: number,
    label?: string,
    description?: string,
    endOfLife?: Date,
  ){
    return await this._connection.transaction(async manager => {
      const uuid = uuidv4();
      const email = `${uuid}@serviceaccounts.local`;
      const serviceUser = await this._homeDb.getUserByLogin(email, {manager}, 'service');
      const apiKey = (await this._homeDb.createApiKey(serviceUser.id, false, manager)).apiKey;
      const sanitizedLabel: string = label ? label : "";
      const sanitizedDescription: string = description ? description : "";
      // End of life is set to now leading to a non functionning service service_account_id
      // if not provided;
      const sanitizedEndOfLife = this._sanitizeDateString(endOfLife);
      // FIXME use manager.save(entity);
      const insert = await manager.createQueryBuilder()
        .insert()
        .into(ServiceAccount)
        .values({
          owner_id: ownerId,
          service_user_id: serviceUser.id,
          label: sanitizedLabel,
          description: sanitizedDescription,
          endOfLife: sanitizedEndOfLife,
        })
        .execute();
      return {
        id: insert.raw,
        key: apiKey,
        msg: "Please save your api key. It's the only time you will see it.",
        label: sanitizedLabel,
        description: sanitizedDescription,
        endOfLife: sanitizedEndOfLife,
      };
    });
  }

  public async readServiceAccount(
    serviceAccountId: number,
    ownerId: number,
  ){
    return await this._connection.transaction(async manager => {
      return (await manager.createQueryBuilder()
        .select("*")
        .from(ServiceAccount, "service_accounts")
        .where("owner_id = :ownerId", {ownerId})
        .andWhere("id = :serviceAccountId", {serviceAccountId})
        .execute())[0];
    });
  }

  public async readAllServiceAccounts(
    ownerId: number,
  ){
    return await this._connection.transaction(async manager => {
      return await manager.createQueryBuilder()
        .select("*")
        .from(ServiceAccount, "service_accounts")
        .where("owner_id = :ownerId", {ownerId})
        .execute();
    });
  }

  public async updateServiceAccount(
    serviceAccountId: number,
    ownerId: number,
    partial: any,
  ){
    const authorizedPatchKeys = ["label", "description", "endOfLife"];
    for (const key in partial){
      if (!authorizedPatchKeys.includes(key)){
        throw new ApiError(`invalid key ${key}`, 400);
      }
    }
    if (typeof partial.label != 'undefined' && typeof partial.label != 'string'){
        throw new ApiError(`invalid value for label. Must be a string`, 400);
    }
    if (typeof partial.endOfLife != 'undefined'){
      partial.endOfLife = this._sanitizeDateString(partial.endOfLife);
    }
    return await this._connection.transaction(async manager => {
      return await manager.createQueryBuilder()
        .update(ServiceAccount)
        .set(partial)
        .where(
          "owner_id = :ownerId AND id = :serviceAccountId",
          {
            ownerId,
            serviceAccountId
          }
        )
        .execute();
    });
  }

  public async deleteServiceAccount(
    serviceAccountId: number,
    ownerId: number,
  ){
    return await this._connection.transaction(async manager => {
      return await manager.createQueryBuilder()
        .delete()
        .from(ServiceAccount)
        .where(
          "owner_id = :ownerId AND id = :serviceAccountId",
          {
            ownerId,
            serviceAccountId
          }
        )
        .execute();
    });
  }

  public async rotateServiceAccountApiKey(
    serviceAccountId: number,
    ownerId: number,
  ){
    return await this._connection.transaction(async manager => {
      // TODO factorize with this.readServiceAccount
      const serviceUser = (await manager.createQueryBuilder()
        .select("*")
        .from(ServiceAccount, "service_accounts")
        .where("owner_id = :ownerId", {ownerId})
        .andWhere("id = :serviceAccountId", {serviceAccountId})
        .execute())[0];
      if (typeof serviceUser === "undefined"){
        throw new ApiError(`Can't rotate api key of non existing service account ${serviceAccountId}`, 404);
      }
      const apiKey = (await this._homeDb.createApiKey(serviceUser.id, true, manager)).apiKey;
      return {
        id: serviceUser.id,
        key: apiKey,
        msg: "Please save your api key. It's the only time you will see it.",
        label: serviceUser.label,
        description: serviceUser.description,
        endOfLife: serviceUser.endOfLife
      };
    });
  }

  public async revokeServiceAccountApiKey(
    serviceAccountId: number,
    ownerId: number,
  ){
    return await this._connection.transaction(async manager => {
      // TODO factorize with this.readServiceAccount
      const serviceUser = (await manager.createQueryBuilder()
        .select("*")
        .from(ServiceAccount, "service_accounts")
        .where("owner_id = :ownerId", {ownerId})
        .andWhere("id = :serviceAccountId", {serviceAccountId})
        .execute())[0];
      if (typeof serviceUser === "undefined"){
        throw new ApiError(`Can't revoke api key of non existing service account ${serviceAccountId}`, 404);
      }
      const apiKey = await this._homeDb.deleteApiKey(serviceUser.id, manager);
      return {
        id: serviceUser.id,
        key: apiKey,
        msg: "Please save your api key. It's the only time you will see it.",
        label: serviceUser.label,
        description: serviceUser.description,
        endOfLife: serviceUser.endOfLife
      };
    });
  }

  private _sanitizeDateString(dateString: any): string{
    try {
      return dateString ?
        new Date(dateString).toISOString().split('T')[0] :
        new Date().toISOString().split('T')[0];
    } catch (e){
      throw new ApiError(`Bad Request: endOfLife ${dateString} is not a valid date.\n ${e}`, 400);
    }
  }
}
