import { EntityManager } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { ApiError } from 'app/common/ApiError';
import { ServiceAccount } from 'app/gen-server/entity/ServiceAccount';
import { HomeDBManager } from 'app/gen-server/lib/homedb/HomeDBManager';
import { RunInTransaction } from 'app/gen-server/lib/homedb/Interfaces';
import { UsersManager } from 'app/gen-server/lib/homedb/UsersManager';

export class ServiceAccountsManager {

  private get _connection () {
    return this._homeDb.connection;
  }

  public constructor(
    private readonly _homeDb: HomeDBManager,
    private _usersManager: UsersManager,
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
    endOfLife?: Date,
  ) {
    return await this._connection.transaction(async manager => {
      const uuid = uuidv4();
      // We use .invalid as tld following RFC 2606
      // as we don't ever want service user to be able to recieve any email
      // and then be able to connect via link in email
      const login = `${uuid}@serviceaccounts.invalid`;
      // Using getUserByLogin will create the user... Yeah, please don't blame us.
      const serviceUser = await this._homeDb.getUserByLogin(login, {manager}, 'service');

      await this._homeDb.createApiKey(serviceUser.id, false, manager);

      const newServiceAccount = ServiceAccount.create({
        ownerId,
        serviceUserId: serviceUser.id,
        label,
        description,
        endOfLife
      });
      await manager.save(newServiceAccount);
      return (await this.readServiceAccount(login, manager))!;
    });
  }

  public async readServiceAccount(
    serviceAccountLogin: string,
    transaction?: EntityManager
  ) {
    return await this._runInTransaction(transaction, async manager => {
      const user = await this._getServiceAccountUserByLogin(serviceAccountLogin, manager);

      // Make a backward reference of the user. It's OK for most cases,
      // but improper for updates as TypeORM can't handle circular references.
      if (user?.serviceAccount) {
        user.serviceAccount.serviceUser = user;
      }

      return user?.serviceAccount;
    });
  }

  public async readAllServiceAccounts(
    ownerId: number,
  ) {
    return await this._connection.transaction(async manager => {
      return await manager.find(
        ServiceAccount,
        {where: {ownerId}}
      );
    });
  }

  public async updateServiceAccount(
    serviceAccountLogin: string,
    partial: Partial<ServiceAccount>,
    options: {expectedOwnerId?: number} = {},
  ) {
    const { expectedOwnerId } = options;
    return await this._connection.transaction(async manager => {
      const { serviceAccount } = await this._getServiceAccountUserByLogin(serviceAccountLogin, manager) ?? {};
      if (!serviceAccount) {
        return serviceAccount;
      }
      if (expectedOwnerId !== undefined && expectedOwnerId !== serviceAccount.ownerId) {
        throw new ApiError("Operation not allowed", 403);
      }
      ServiceAccount.merge(serviceAccount, partial);
      return await manager.save(serviceAccount);
    });
  }

  public async deleteServiceAccount(
    serviceAccountLogin: string,
    ownerId: number,
  ) {
    return await this._connection.transaction(async manager => {
      const serviceUser = await this._homeDb.getExistingUserByLogin(serviceAccountLogin, manager);
      if (serviceUser == null) {
        return serviceUser;
      }
      // We perform a soft delete
      // as we don't want a service user's apiKey to still work
      serviceUser.apiKey = null;
      serviceUser.deletedAt = new Date();
      await manager.save(serviceUser);
      return await manager.delete(
        ServiceAccount,
        {serviceUserId: serviceUser.id, ownerId}
      );
    });
  }

  public async rotateServiceAccountApiKey(
    serviceAccountLogin: string,
    ownerId: number,
  ) {
    return await this._connection.transaction(async manager => {
      const serviceUser = await this._homeDb.getExistingUserByLogin(serviceAccountLogin, manager);
      if (serviceUser == null) {
        return serviceUser;
      }
      const serviceAccount = await manager.findOne(
        ServiceAccount,
        {where: {serviceUserId: serviceUser.id, ownerId}}
      );
      if (serviceAccount == null) {
        return serviceAccount;
      }
      const updatedServiceUser = await this._homeDb.createApiKey(serviceUser.id, true, manager);
      (serviceAccount as any).user = updatedServiceUser;
      return serviceAccount;
    });
  }

  public async revokeServiceAccountApiKey(
    serviceAccountLogin: string,
    ownerId: number,
  ) {
    return await this._connection.transaction(async manager => {
      const serviceUser = await this._homeDb.getExistingUserByLogin(serviceAccountLogin, manager);
      if (serviceUser == null) {
        return serviceUser;
      }
      const serviceAccount = await manager.findOne(
        ServiceAccount,
        {where: {serviceUserId: serviceUser.id, ownerId}}
      );
      if (serviceAccount == null) {
        return serviceAccount;
      }
      await this._homeDb.deleteApiKey(serviceUser.id, manager);
      (serviceAccount as any).user = serviceUser;
      return serviceAccount;
    });
  }

  public async isAliveServiceAccount(serviceAccountLogin: string) {
    return await this._connection.transaction(async manager => {
      const serviceUser = await this._homeDb.getExistingUserByLogin(serviceAccountLogin, manager);
      if (serviceUser == null) {
        throw new ApiError(`User don't exists`, 404);
      }
      if (serviceUser.type !== "service") {
        throw new ApiError(`User is not of type service`, 403);
      }
      const serviceAccount = await manager.findOne(
        ServiceAccount,
        {where: {serviceUserId: serviceUser.id}}
      );
      if (serviceAccount == null) {
        throw new ApiError(`This Service Account no longer exists`, 404);
      }
      const endOfLife = new Date(serviceAccount.endOfLife);
      const currentDate = new Date();
      return endOfLife > currentDate;
    });
  }

  private async _getServiceAccountUserByLogin(serviceAccountLogin: string, transaction?: EntityManager) {
    // Take advantage of buildExistingUsersByLoginRequest (especially for normalizing the passed email).
    const serviceUserQuery = this._usersManager.buildExistingUsersByLoginRequest([serviceAccountLogin], transaction);
    return await serviceUserQuery
      .innerJoinAndSelect("user.serviceAccount", "serviceAccount")
      .getOne();
  }
}
