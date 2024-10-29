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
  public async deleteAllServiceAccounts(optManager?: EntityManager) {
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
    endOfLife?: string,
  ) {
    return await this._connection.transaction(async manager => {
      const uuid = uuidv4();
      const login = `${uuid}@serviceaccounts.local`;
      const serviceUser = await this._homeDb.getUserByLogin(login, {manager}, 'service');
      const serviceUserWithkey = await this._homeDb.createApiKey(serviceUser.id, false, manager);
      const newServiceAccount = new ServiceAccount();
      newServiceAccount.owner_id = ownerId;
      newServiceAccount.service_user_id = serviceUser.id;
      newServiceAccount.label = label ? label : "";
      newServiceAccount.description = description ? description : "";
      newServiceAccount.end_of_life = this._sanitizeDateString(endOfLife);
      const serviceAccount = await manager.save(newServiceAccount);
      return {
        login: login,
        key: serviceUserWithkey.apiKey,
        msg: this._msg,
        label: serviceAccount.label,
        description: serviceAccount.description,
        endOfLife: serviceAccount.end_of_life,
        hasValidKey: true
      };
    });
  }

  public async readServiceAccount(
    serviceAccountLogin: string,
    ownerId: number,
    transaction?: EntityManager
  ) {
    return await this._runInTransaction(transaction, async manager => {
      const serviceUser = await this._homeDb.getUserByLogin(serviceAccountLogin, {manager}, 'service');
      const serviceAccount = await manager.findOne(
        ServiceAccount,
        {where: {service_user_id: serviceUser.id, owner_id: ownerId}}
      );
      if (serviceAccount == null) {
         throw new ApiError(`No such service account ${serviceAccountLogin}`, 404);
      }
      const hasValidKey = !(serviceUser.apiKey == null);
      return {
        login: serviceAccountLogin,
        label: serviceAccount.label,
        description: serviceAccount.description,
        endOfLife: serviceAccount.end_of_life,
        hasValidKey
      };
    });
  }

  public async readAllServiceAccounts(
    ownerId: number,
  ) {
    return await this._connection.transaction(async manager => {
      return await manager.find(
        ServiceAccount,
        {where: {owner_id: ownerId}}
      );
    });
  }

  public async updateServiceAccount(
    serviceAccountLogin: string,
    ownerId: number,
    partial: any,
  ) {
    const authorizedPatchKeys = ["label", "description", "endOfLife"];
    for (const key in partial) {
      if (!authorizedPatchKeys.includes(key)) {
        throw new ApiError(`invalid key ${key}`, 400);
      }
    }
    if (typeof partial.label != 'undefined' && typeof partial.label != 'string') {
        throw new ApiError(`invalid value for label. Must be a string`, 400);
    }
    if (typeof partial.endOfLife != 'undefined') {
      partial.endOfLife = this._sanitizeDateString(partial.endOfLife);
    }
    return await this._connection.transaction(async manager => {
      const serviceUser = await this._homeDb.getUserByLogin(serviceAccountLogin, {manager}, 'service');
      return await manager.update(
        ServiceAccount,
        {service_user_id: serviceUser.id, owner_id: ownerId},
        partial
      );
    });
  }

  public async deleteServiceAccount(
    serviceAccountLogin: string,
    ownerId: number,
  ) {
    return await this._connection.transaction(async manager => {
      const serviceUser = await this._homeDb.getUserByLogin(serviceAccountLogin, {manager}, 'service');
      return await manager.delete(
        ServiceAccount,
        {service_user_id: serviceUser.id, owner_id: ownerId}
      );
    });
  }

  public async rotateServiceAccountApiKey(
    serviceAccountLogin: string,
    ownerId: number,
  ) {
    return await this._connection.transaction(async manager => {
      const serviceUser = await this._homeDb.getUserByLogin(serviceAccountLogin, {manager}, 'service');
      const serviceAccount = await manager.findOne(
        ServiceAccount,
        {where: {service_user_id: serviceUser.id, owner_id: ownerId}}
      );
      if (serviceAccount == null) {
        throw new ApiError(`Can't rotate api key of non existing service account ${serviceAccountLogin}`, 404);
      }
      if (serviceUser == null) {
        throw new ApiError(`Service User linked to service Account ${serviceAccount.id} no longer exists`, 500);
      }
      const updatedServiceUser = await this._homeDb.createApiKey(serviceUser.id, true, manager);
      return {
        login: serviceAccountLogin,
        key: updatedServiceUser.apiKey,
        msg: this._msg,
        label: serviceAccount.label,
        description: serviceAccount.description,
        endOfLife: serviceAccount.end_of_life,
        hasValidKey: true
      };
    });
  }

  public async revokeServiceAccountApiKey(
    serviceAccountLogin: string,
    ownerId: number,
  ) {
    return await this._connection.transaction(async manager => {
      const serviceUser = await this._homeDb.getUserByLogin(serviceAccountLogin, {manager}, 'service');
      if (serviceUser == null) {
        throw new ApiError(`Can't revoke api key of non existing service account User ${serviceAccountLogin}`, 404);
      }
      const serviceAccount = await manager.findOne(
        ServiceAccount,
        {where: {service_user_id: serviceUser.id, owner_id: ownerId}}
      );
      if (serviceAccount == null) {
        throw new ApiError(`Can't revoke api key of non existing service account ${serviceAccountLogin}`, 404);
      }
      await this._homeDb.deleteApiKey(serviceUser.id, manager);
      return;
    });
  }

  public async isAliveServiceAccount(serviceAccountLogin: string) {
    return await this._connection.transaction(async manager => {
      const serviceUser = await this._homeDb.getUserByLogin(serviceAccountLogin, {manager}, 'service');
      if (serviceUser == null) {
        throw new ApiError(`User don't exists`, 404);
      }
      if (serviceUser.type !== "service") {
        throw new ApiError(`User is not of type service`, 403);
      }
      const serviceAccount = await manager.findOne(
        ServiceAccount,
        {where: {service_user_id: serviceUser.id}}
      );
      if (serviceAccount == null) {
        throw new ApiError(`This Service Account no longer exists`, 404);
      }
      const endOfLife = new Date(serviceAccount.end_of_life);
      const currentDate = new Date();
      return endOfLife > currentDate;
    });
  }

  private _sanitizeDateString(dateString: string = new Date().toISOString()): string {
    try {
      // We want an empty dateString to set the endOfLife to
      // previous midnight so the key is outdated at creation
      // however an empty string is not a valid string to initialize a
      // date.
      if (dateString === ""){
        return new Date().toISOString().split('T')[0];
      }
      return new Date(dateString).toISOString().split('T')[0];
    } catch (e) {
      throw new ApiError(`Bad Request: endOfLife ${dateString} is not a valid date.\n ${e}`, 400);
    }
  }
}
