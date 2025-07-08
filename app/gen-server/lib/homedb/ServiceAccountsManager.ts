import { EntityManager } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { ApiError } from 'app/common/ApiError';
import { ServiceAccount } from 'app/gen-server/entity/ServiceAccount';
import { HomeDBManager } from 'app/gen-server/lib/homedb/HomeDBManager';
import { RunInTransaction } from 'app/gen-server/lib/homedb/Interfaces';

export class ServiceAccountsManager {

  private _msg = "Please save your api key. It's the only time you will see it.";


  private get _connection () {
    return this._homeDb.connection;
  }

  public constructor(
    private readonly _homeDb: HomeDBManager,
    private _runInTransaction: RunInTransaction
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
      const key = (await this._homeDb.createApiKey(serviceUser.id, false, manager)).apiKey;
      const newServiceAccount = new ServiceAccount();
      newServiceAccount.owner_id = ownerId;
      newServiceAccount.service_user_id = serviceUser.id;
      newServiceAccount.label = label ? label : "";
      newServiceAccount.description = description ? description : "";
      newServiceAccount.endOfLife = this._sanitizeDateString(endOfLife);
      const serviceAccount = await manager.save(newServiceAccount);
      return {
        id: serviceAccount.id,
        key,
        msg: this._msg,
        label: serviceAccount.label,
        description: serviceAccount.description,
        endOfLife: serviceAccount.endOfLife
      };
    });
  }

  public async readServiceAccount(
    serviceAccountId: number,
    ownerId: number,
    transaction?: EntityManager
  ){
    return await this._runInTransaction(transaction, async manager => {
      return await manager.findOne(
        ServiceAccount,
        {where: {id: serviceAccountId, owner_id: ownerId}}
      );
    });
  }

  public async readAllServiceAccounts(
    ownerId: number,
  ){
    return await this._connection.transaction(async manager => {
      return await manager.find(
        ServiceAccount,
        {where: {owner_id: ownerId}}
      );
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
      return await manager.update(
        ServiceAccount,
        {where: {id: serviceAccountId, owner_id: ownerId}},
        partial
      );
    });
  }

  public async deleteServiceAccount(
    serviceAccountId: number,
    ownerId: number,
  ){
    return await this._connection.transaction(async manager => {
      return await manager.delete(
        ServiceAccount,
        {where: {id: serviceAccountId, owner_id: ownerId}}
      );
    });
  }

  public async rotateServiceAccountApiKey(
    serviceAccountId: number,
    ownerId: number,
  ){
    return await this._connection.transaction(async manager => {
      const serviceUser = await this.readServiceAccount(serviceAccountId, ownerId, manager);
      if (serviceUser == null){
        throw new ApiError(`Can't rotate api key of non existing service account ${serviceAccountId}`, 404);
      }
      const apiKey = (await this._homeDb.createApiKey(serviceUser.id, true, manager)).apiKey;
      return {
        id: serviceUser.id,
        key: apiKey,
        msg: this._msg,
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
      const serviceUser = await this.readServiceAccount(serviceAccountId, ownerId, manager);
      if (serviceUser == null){
        throw new ApiError(`Can't revoke api key of non existing service account ${serviceAccountId}`, 404);
      }
      await this._homeDb.deleteApiKey(serviceUser.id, manager);
      return;
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
